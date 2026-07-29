import "./env-setup.js";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { addClient } from "./broadcast.js";
import { createSendblueRouter } from "./sendblue.js";
import { handleUserMessage } from "./interaction-agent.js";
import { loadIntegrations } from "./integrations/registry.js";
import { startCleanupLoop } from "./memory/clean.js";
import { startAutomationLoop } from "./automations.js";
import { startHeartbeatLoop } from "./heartbeat.js";
import { startConsolidationLoop } from "./consolidation.js";
import { cancelAgent, retryAgent } from "./execution-agent.js";
import { createComposioRouter } from "./composio-routes.js";
import { createBrowserRouter } from "./browser-routes.js";
import { stopStealthChrome } from "./browser/stealth-launcher.js";
import { ensureProactiveWatcher } from "./proactive-email.js";
import { preloadLocalModel } from "./embeddings.js";
import { createMemoryRouter } from "./memory-routes.js";
import { createAppleRouter } from "./apple-routes.js";
import { closeLocalBrowser } from "./browser/launcher.js";
import { createChangelogRouter } from "./changelog.js";
import { assertPublicAuthSecretConfigured, createPublicAuthRouter } from "./public-auth-routes.js";
import {
  getRuntimeConfig,
  resolveModelInput,
  resolveReasoningEffortInput,
  resolveRuntimeInput,
  setCodexReasoningEffort,
  setRuntimeModel,
  setRuntimeProvider,
} from "./runtime-config.js";
import { startImageCleanup } from "./images/clean.js";
import { createStreakRouter } from "./streak-routes.js";
import { startWeeklyLoop } from "./weekly/service.js";
import { createWeeklyRouter } from "./weekly-routes.js";
import { startNudgeLoop } from "./nudge/service.js";
import { createNudgeRouter } from "./nudge-routes.js";
import { isPublicServerRequest, isTrustedLocalRequest } from "./local-access.js";
import { applySecurityHeaders } from "./http-security.js";
import { buildCorsOrigins } from "./cors-origins.js";

function mountPublicWeb(app: express.Express) {
  if (process.env.BOOP_SERVE_WEB === "false") return false;

  const webDist = resolve(process.cwd(), "dist/web");
  const indexHtml = resolve(webDist, "index.html");
  if (!existsSync(indexHtml)) return false;

  app.use(express.static(webDist, { index: false, fallthrough: true }));
  app.get(["/", "/dashboard"], (_req, res) => {
    res.sendFile(indexHtml);
  });
  return true;
}

async function main() {
  // Fail fast, before any other startup work, if this is a real deployment
  // missing PUBLIC_AUTH_SECRET — better to never come up than to come up and
  // silently hash phone-login OTPs with a weak fallback key.
  assertPublicAuthSecretConfigured();

  await loadIntegrations();
  startCleanupLoop();
  startAutomationLoop();
  startHeartbeatLoop();
  startConsolidationLoop();
  startImageCleanup();
  // The streak card is sent reactively from touchStreak() on the user's first
  // message each local day — no scheduled loop needed (see server/streak/service.ts).
  // Weekly "mindset + person of the week" loop (opt-in via BOOP_WEEKLY_ENABLED).
  // Cheap gate each tick; the LLM generation + sends only fire when a drop or
  // mid-week insight is actually due for a user.
  startWeeklyLoop();
  // Proactive nudges: unprompted texts when the user's own state says they're
  // slipping (opt-in via BOOP_NUDGE_ENABLED). Each tick is a cheap read; the
  // generation + send only happen when a real situation clears the annoyance
  // rules in server/nudge/policy.ts.
  startNudgeLoop();
  // No-op when a paid embedding key is set; otherwise downloads/loads the
  // local BGE-large model in the background so the first user-facing
  // recall() doesn't pay the model-load cost.
  preloadLocalModel();

  // If a stable public URL is configured, register the Composio webhook +
  // Gmail trigger now. For ngrok-based dev, scripts/dev.mjs drives the same
  // function once the ngrok URL is known, so we skip when only the local
  // PORT default is available.
  const stableUrl = process.env.PUBLIC_URL;
  if (stableUrl && !stableUrl.includes("localhost")) {
    ensureProactiveWatcher(stableUrl).catch((err) =>
      console.error("[proactive] startup failed", err),
    );
  }

  const app = express();
  // Railway (and any other single reverse proxy) terminates TLS and forwards
  // the client address in x-forwarded-for. express-rate-limit needs req.ip to
  // be the real caller, otherwise every request buckets under the proxy.
  // The local-access gate below is unaffected: it reads socket.remoteAddress
  // and the forwarding headers directly rather than trusting req.ip.
  app.set("trust proxy", 1);
  // Before the access gate so 404s and static assets are covered too.
  applySecurityHeaders(app);
  app.use((req, res, next) => {
    if (isPublicServerRequest(req) || isTrustedLocalRequest(req)) {
      next();
      return;
    }
    res.status(404).json({ error: "not found" });
  });
  app.use(cors({ origin: buildCorsOrigins(process.env) }));
  // Composio webhook receiver must read raw bytes for HMAC verification, so
  // its body parser is mounted BEFORE the global express.json. Without this
  // ordering the JSON parser consumes the stream first and the raw buffer
  // arrives empty.
  app.use("/composio/webhook", express.raw({ type: "application/json", limit: "2mb" }));
  app.use(express.json({ limit: "2mb" }));

  app.get("/health", (_req, res) => {
    res.json({ ok: true, service: "boop-agent" });
  });

  app.get("/runtime-config", async (_req, res) => {
    try {
      res.json(await getRuntimeConfig());
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.post("/runtime-config", async (req, res) => {
    try {
      const body = req.body as {
        runtime?: unknown;
        model?: unknown;
        reasoningEffort?: unknown;
      };
      let runtime =
        body.runtime === undefined
          ? undefined
          : resolveRuntimeInput(String(body.runtime));
      if (body.runtime !== undefined && !runtime) {
        res.status(400).json({ error: `Unknown runtime "${String(body.runtime)}"` });
        return;
      }

      if (runtime) {
        await setRuntimeProvider(runtime);
      }

      runtime ??= (await getRuntimeConfig()).runtime;

      if (body.model !== undefined) {
        const model = resolveModelInput(String(body.model), runtime);
        if (!model) {
          res
            .status(400)
            .json({ error: `Unknown ${runtime} model "${String(body.model)}"` });
          return;
        }
        await setRuntimeModel(model, runtime);
      }

      if (body.reasoningEffort !== undefined) {
        const effort = resolveReasoningEffortInput(String(body.reasoningEffort));
        if (!effort) {
          res.status(400).json({
            error: `Unknown Codex reasoning effort "${String(body.reasoningEffort)}"`,
          });
          return;
        }
        await setCodexReasoningEffort(effort);
      }

      res.json(await getRuntimeConfig());
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  const publicAuthRouter = createPublicAuthRouter();
  app.use("/sendblue", createSendblueRouter());
  app.use("/public-auth", publicAuthRouter);
  app.use("/api/public-auth", publicAuthRouter);
  app.use("/composio", createComposioRouter());
  app.use("/memory", createMemoryRouter());
  app.use("/browser", createBrowserRouter());
  app.use("/apple", createAppleRouter());
  app.use("/changelog", createChangelogRouter());
  app.use("/streak", createStreakRouter());
  app.use("/weekly", createWeeklyRouter());
  app.use("/nudge", createNudgeRouter());
  const publicWebMounted = mountPublicWeb(app);

  app.post("/agents/:id/cancel", (req, res) => {
    const ok = cancelAgent(req.params.id);
    res.json({ ok });
  });

  app.post("/consolidate", async (_req, res) => {
    try {
      const { runConsolidation } = await import("./consolidation.js");
      // Fire-and-forget so the HTTP request returns immediately.
      runConsolidation("manual").catch((err) =>
        console.error("[consolidation] manual run failed", err),
      );
      res.json({ ok: true, triggered: "manual" });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.post("/agents/:id/retry", async (req, res) => {
    const result = await retryAgent(req.params.id);
    if (!result) {
      res.status(404).json({ error: "agent not found" });
      return;
    }
    res.json(result);
  });

  // Chat endpoint for local testing and the debug dashboard
  app.post("/chat", async (req, res) => {
    const { conversationId, content } = req.body ?? {};
    if (!conversationId || !content) {
      res.status(400).json({ error: "conversationId and content required" });
      return;
    }
    try {
      const reply = await handleUserMessage({
        conversationId,
        content,
        persistAssistantReply: true,
      });
      res.json({ reply });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: String(err) });
    }
  });

  const server = createServer(app);
  const wss = new WebSocketServer({ server, path: "/ws" });
  wss.on("connection", (ws, request) => {
    if (!isTrustedLocalRequest(request)) {
      ws.close(1008, "local connections only");
      return;
    }
    addClient(ws);
    ws.send(JSON.stringify({ event: "hello", data: { ok: true }, at: Date.now() }));
  });

  const port = Number(process.env.PORT ?? 3456);
  server.listen(port, () => {
    console.log(`boop-agent server listening on :${port}`);
    console.log(`  health      GET  http://localhost:${port}/health`);
    if (publicWebMounted) {
      console.log(`  web         GET  http://localhost:${port}/`);
      console.log(`  dashboard   GET  http://localhost:${port}/dashboard`);
    }
    console.log(`  chat        POST http://localhost:${port}/chat`);
    console.log(`  sendblue    POST http://localhost:${port}/sendblue/webhook`);
    console.log(`  websocket   WS   ws://localhost:${port}/ws`);
  });

  // Make sure the Chrome we own dies when the server does. tsx watch sends
  // SIGTERM on file changes; without this Chrome leaks across reloads and
  // the next stealth-bootstrap fights its own zombie for the profile lock.
  const signalExitCodes = { SIGTERM: 143, SIGINT: 130, SIGHUP: 129 } as const;
  let shuttingDown = false;
  for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"] as const) {
    process.on(sig, () => {
      if (shuttingDown) return;
      shuttingDown = true;
      stopStealthChrome();
      closeLocalBrowser()
        .catch(() => undefined)
        .finally(() => process.exit(signalExitCodes[sig]));
    });
  }
}

main().catch((err) => {
  console.error("fatal", err);
  process.exit(1);
});

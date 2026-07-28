import crypto from "node:crypto";
import express from "express";
import rateLimit from "express-rate-limit";
import { api } from "../convex/_generated/api.js";
import { convex } from "./convex-client.js";
import { normalizeE164, sendImessage } from "./sendblue.js";
import { redactContactHandle } from "./privacy.js";
import {
  describeUserNow,
  resolveTimezoneInput,
  setUserTimezone,
} from "./timezone-config.js";
import {
  authorizeToolkit,
  ComposioKeyPermissionError,
  ComposioNeedsAuthConfigError,
  composioUserIdForPhone,
  CURATED_TOOLKITS,
  disconnectToolkit,
  displayNameFor,
  getComposio,
  listConnectedToolkitsForUser,
  listToolkitMeta,
  listToolkitSlugsWithAuthConfig,
  listToolsForToolkit,
  renameConnection,
} from "./composio.js";
import { dashboardMagicTokenHash, issueJoinCode } from "./public-auth-magic.js";

const OTP_TTL_MS = 1000 * 60 * 10;

// "Real deployment" reuses the exact convention already used for the
// outbound SMS gate in server/sendblue.ts: PUBLIC_URL set to a non-localhost
// value.
function isRealDeployment(): boolean {
  const publicUrl = process.env.PUBLIC_URL ?? "";
  return (
    publicUrl.length > 0 &&
    !publicUrl.includes("localhost") &&
    !publicUrl.includes("127.0.0.1")
  );
}

// The OTP hash key used to matter less when it just meant "don't store raw
// login codes" — but falling back to SENDBLUE_API_SECRET (a different
// secret, used for a different purpose, that this router doesn't own) or
// CONVEX_DEPLOYMENT (not a secret at all — a deployment slug like
// "dev:foo-bar-123" that regularly ends up in URLs and logs) meant a real
// deployment could end up hashing OTPs with materially weaker or
// unintentionally shared key material. Real deployments must set
// PUBLIC_AUTH_SECRET explicitly; this throws at boot (see
// assertPublicAuthSecretConfigured, called from server/index.ts) rather than
// on the first login attempt. Local dev keeps a static fallback so
// `npm run dev` works out of the box.
function publicAuthSecret(): string {
  const explicit = process.env.PUBLIC_AUTH_SECRET;
  if (explicit) return explicit;
  if (isRealDeployment()) {
    throw new Error(
      "PUBLIC_AUTH_SECRET is required when PUBLIC_URL points at a real deployment " +
        "(phone-login OTPs would otherwise hash with a weak or shared fallback key). " +
        "Generate one with: openssl rand -base64 32",
    );
  }
  return "azraj-dev-only-insecure-fallback";
}

export function assertPublicAuthSecretConfigured() {
  publicAuthSecret();
}

function codeHash(phoneE164: string, code: string) {
  return crypto
    .createHash("sha256")
    .update(`${publicAuthSecret()}:${phoneE164}:${code}`)
    .digest("hex");
}

function createCode() {
  return String(crypto.randomInt(100000, 1000000));
}

function createSessionToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function normalizeCode(value: unknown) {
  return typeof value === "string" ? value.replace(/\D/g, "").slice(0, 6) : "";
}

function normalizeMagicToken(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, 256) : "";
}

// Echoing the login code back in the HTTP response is a complete auth bypass
// for anyone who can POST a phone number, so it fails closed: an explicit
// opt-in is required rather than inferring safety from the absence of
// NODE_ENV=production (which no deploy config here actually guarantees).
export function devCodePayload(code: string) {
  return process.env.BOOP_DEV_OTP_ECHO === "true" ? { devCode: code } : {};
}

// Outer wall for the two unauthenticated endpoints. /start costs real money on
// every call (it sends an iMessage); /verify guards account access. The
// per-phone throttle in convex/publicUsers.ts is the inner wall — these IP
// limits only blunt single-source floods.
const startLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "too many login codes requested — try again later" },
});

const verifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "too many attempts — try again later" },
});

function sessionTokenFromBody(body: unknown) {
  return body && typeof body === "object" && "sessionToken" in body
    ? String((body as { sessionToken?: unknown }).sessionToken ?? "")
    : "";
}

async function getPublicSession(sessionToken: string) {
  if (!sessionToken) return null;
  return await convex.query(api.publicUsers.getSession, { sessionToken });
}

async function listPublicToolkits(composioUserId: string, includeCatalog: boolean) {
  const [connected, configured, meta] = await Promise.all([
    listConnectedToolkitsForUser(composioUserId),
    listToolkitSlugsWithAuthConfig(),
    listToolkitMeta(),
  ]);

  const connectionsBySlug = new Map<string, typeof connected>();
  for (const c of connected) {
    const arr = connectionsBySlug.get(c.slug) ?? [];
    arr.push(c);
    connectionsBySlug.set(c.slug, arr);
  }
  for (const arr of connectionsBySlug.values()) {
    arr.sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));
  }

  const toConnectionView = (c: (typeof connected)[number]) => ({
    id: c.connectionId,
    status: c.status,
    alias: c.alias ?? null,
    accountLabel: c.accountLabel ?? null,
    accountEmail: c.accountEmail ?? null,
    accountName: c.accountName ?? null,
    accountAvatarUrl: c.accountAvatarUrl ?? null,
    createdAt: c.createdAt ?? null,
  });

  const curated = CURATED_TOOLKITS.map((t) => {
    const m = meta.get(t.slug);
    const conns = connectionsBySlug.get(t.slug) ?? [];
    return {
      slug: t.slug,
      displayName: t.displayName,
      authMode: t.authMode,
      hasAuthConfig: configured.has(t.slug),
      logoUrl: m?.logo ?? null,
      description: m?.description ?? null,
      toolCount: m?.toolsCount ?? null,
      connections: conns.map(toConnectionView),
    };
  });

  const curatedSlugs = new Set(CURATED_TOOLKITS.map((t) => t.slug));
  const extraSlugs = includeCatalog
    ? [...meta.keys()].filter((slug) => !curatedSlugs.has(slug))
    : [...connectionsBySlug.keys()].filter((slug) => !curatedSlugs.has(slug));

  const extras = extraSlugs
    .sort((a, b) => {
      const aName = meta.get(a)?.name ?? displayNameFor(a);
      const bName = meta.get(b)?.name ?? displayNameFor(b);
      return aName.localeCompare(bName);
    })
    .map((slug) => {
      const conns = connectionsBySlug.get(slug) ?? [];
      const m = meta.get(slug);
      const authMode: "managed" | "byo" = configured.has(slug) ? "byo" : "managed";
      return {
        slug,
        displayName: m?.name ?? displayNameFor(slug),
        authMode,
        hasAuthConfig: configured.has(slug),
        logoUrl: m?.logo ?? null,
        description: m?.description ?? null,
        toolCount: m?.toolsCount ?? null,
        connections: conns.map(toConnectionView),
      };
    });

  return { enabled: Boolean(getComposio()), toolkits: [...curated, ...extras] };
}

export function createPublicAuthRouter(): express.Router {
  const router = express.Router();

  router.post("/dashboard", async (req, res) => {
    const sessionToken = typeof req.body?.sessionToken === "string" ? req.body.sessionToken : "";
    if (!sessionToken) {
      res.status(401).json({ error: "dashboard session required" });
      return;
    }

    const dashboard = await convex.query(api.publicUsers.dashboard, { sessionToken });
    if (!dashboard) {
      res.status(401).json({ error: "dashboard session expired" });
      return;
    }

    res.json({ ok: true, dashboard });
  });

  router.post("/integrations", async (req, res) => {
    const session = await getPublicSession(sessionTokenFromBody(req.body));
    if (!session) {
      res.status(401).json({ error: "dashboard session required" });
      return;
    }
    try {
      const composioUserId = composioUserIdForPhone(session.phoneE164);
      const includeCatalog = req.body?.catalog === "all";
      const data = await listPublicToolkits(composioUserId, includeCatalog);
      res.json(data);
    } catch (err) {
      console.error("[public-auth] integrations list failed", err);
      res.status(500).json({ error: String(err) });
    }
  });

  router.post("/integrations/:slug/tools", async (req, res) => {
    const session = await getPublicSession(sessionTokenFromBody(req.body));
    if (!session) {
      res.status(401).json({ error: "dashboard session required" });
      return;
    }
    try {
      const tools = await listToolsForToolkit(req.params.slug);
      res.json({ tools });
    } catch (err) {
      console.error(`[public-auth] list tools for ${req.params.slug} failed`, err);
      res.status(500).json({ error: String(err) });
    }
  });

  router.post("/integrations/:slug/authorize", async (req, res) => {
    const session = await getPublicSession(sessionTokenFromBody(req.body));
    if (!session) {
      res.status(401).json({ error: "dashboard session required" });
      return;
    }
    const slug = req.params.slug;
    const alias = typeof req.body?.alias === "string" ? req.body.alias.trim() : undefined;
    try {
      const result = await authorizeToolkit(slug, {
        composioUserId: composioUserIdForPhone(session.phoneE164),
        ...(alias ? { alias } : {}),
      });
      res.json(result);
    } catch (err) {
      if (err instanceof ComposioNeedsAuthConfigError) {
        res.status(409).json({
          error: err.message,
          needsAuthConfig: true,
          toolkit: slug,
          setupUrl: "https://dashboard.composio.dev",
        });
        return;
      }
      if (err instanceof ComposioKeyPermissionError) {
        res.status(403).json({
          error: err.message,
          keyPermission: true,
          toolkit: slug,
          setupUrl: "https://dashboard.composio.dev",
        });
        return;
      }
      console.error(`[public-auth] authorize ${slug} failed`, err);
      res.status(500).json({ error: String(err) });
    }
  });

  router.post("/integrations/:slug/disconnect", async (req, res) => {
    const session = await getPublicSession(sessionTokenFromBody(req.body));
    if (!session) {
      res.status(401).json({ error: "dashboard session required" });
      return;
    }
    const connectionId = typeof req.body?.connectionId === "string" ? req.body.connectionId : "";
    if (!connectionId) {
      res.status(400).json({ error: "connectionId required" });
      return;
    }
    try {
      const composioUserId = composioUserIdForPhone(session.phoneE164);
      const owned = (await listConnectedToolkitsForUser(composioUserId)).some(
        (c) => c.connectionId === connectionId && c.slug === req.params.slug,
      );
      if (!owned) {
        res.status(404).json({ error: "connection not found" });
        return;
      }
      await disconnectToolkit(connectionId);
      res.json({ ok: true });
    } catch (err) {
      console.error(`[public-auth] disconnect ${req.params.slug} failed`, err);
      res.status(500).json({ error: String(err) });
    }
  });

  router.post("/integrations/connections/:id/rename", async (req, res) => {
    const session = await getPublicSession(sessionTokenFromBody(req.body));
    if (!session) {
      res.status(401).json({ error: "dashboard session required" });
      return;
    }
    const alias = typeof req.body?.alias === "string" ? req.body.alias.trim() : "";
    if (!alias) {
      res.status(400).json({ error: "alias required" });
      return;
    }
    try {
      const composioUserId = composioUserIdForPhone(session.phoneE164);
      const owned = (await listConnectedToolkitsForUser(composioUserId)).some(
        (c) => c.connectionId === req.params.id,
      );
      if (!owned) {
        res.status(404).json({ error: "connection not found" });
        return;
      }
      await renameConnection(req.params.id, alias);
      res.json({ ok: true });
    } catch (err) {
      console.error(`[public-auth] rename ${req.params.id} failed`, err);
      res.status(500).json({ error: String(err) });
    }
  });

  router.post("/timezone", async (req, res) => {
    const sessionToken = sessionTokenFromBody(req.body);
    const session = await getPublicSession(sessionToken);
    if (!session) {
      res.status(401).json({ error: "dashboard session required" });
      return;
    }

    const rawTimezone = typeof req.body?.timezone === "string" ? req.body.timezone : "";
    const timezone = resolveTimezoneInput(rawTimezone);
    if (!timezone) {
      res.status(400).json({
        error:
          'timezone must be an IANA timezone like "America/New_York" or an alias like "eastern"',
      });
      return;
    }

    try {
      const updated = await convex.mutation(api.publicUsers.setTimezone, {
        sessionToken,
        timezone,
      });
      if (!updated) {
        res.status(401).json({ error: "dashboard session expired" });
        return;
      }
      await setUserTimezone(timezone);
      res.json({ ok: true, timezone, now: await describeUserNow() });
    } catch (err) {
      console.error("[public-auth] timezone update failed", err);
      res.status(500).json({ error: String(err) });
    }
  });

  router.post("/join/start", async (_req, res) => {
    try {
      const result = await issueJoinCode();
      res.json({ ok: true, ...result });
    } catch (err) {
      console.error("[public-auth] join code issue failed", err);
      res.status(500).json({ error: "couldn't create a join code" });
    }
  });

  router.post("/start", startLimiter, async (req, res) => {
    const phoneE164 = normalizeE164(String(req.body?.phone ?? ""));
    if (!phoneE164 || !/^\+\d{10,15}$/.test(phoneE164)) {
      res.status(400).json({ error: "enter a valid phone number" });
      return;
    }

    const code = createCode();
    const issued = await convex.mutation(api.publicUsers.issuePhoneOtp, {
      phoneE164,
      codeHash: codeHash(phoneE164, code),
      expiresAt: Date.now() + OTP_TTL_MS,
    });
    if (!issued.ok) {
      // Nothing is sent and no code is stored, so the previously issued code
      // stays valid for its full TTL.
      const retryAfterSec = Math.max(1, Math.ceil(issued.retryAfterMs / 1000));
      res.setHeader("Retry-After", String(retryAfterSec));
      res.status(429).json({
        error:
          issued.reason === "cooldown"
            ? "a code was just sent — wait a moment before requesting another"
            : "too many codes requested for that number — try again later",
        retryAfterSec,
      });
      return;
    }

    const text = `azraj login code: ${code}. expires in 10 minutes.`;
    const sent = await sendImessage(phoneE164, text);
    if (!sent) {
      res.status(502).json({
        code: "otp_delivery_failed",
        error: "couldn't send the one-time code. check the number and try again.",
      });
      return;
    }
    console.log(`[public-auth] login code sent to ${redactContactHandle(phoneE164)}`);
    res.json({ ok: true, phoneE164, ...devCodePayload(code) });
  });

  router.post("/verify", verifyLimiter, async (req, res) => {
    const phoneE164 = normalizeE164(String(req.body?.phone ?? ""));
    const code = normalizeCode(req.body?.code);
    if (!phoneE164 || !/^\+\d{10,15}$/.test(phoneE164) || code.length !== 6) {
      res.status(400).json({ error: "phone and 6-digit code required" });
      return;
    }

    const sessionToken = createSessionToken();
    const result = await convex.mutation(api.publicUsers.verifyPhoneOtp, {
      phoneE164,
      codeHash: codeHash(phoneE164, code),
      sessionToken,
    });
    if (!result.ok) {
      res.status(401).json({ error: result.reason });
      return;
    }
    res.json(result);
  });

  router.post("/magic/verify", async (req, res) => {
    const token = normalizeMagicToken(req.body?.token);
    if (!token) {
      res.status(400).json({ error: "dashboard link token required" });
      return;
    }

    const sessionToken = createSessionToken();
    const result = await convex.mutation(api.publicUsers.redeemDashboardMagicLink, {
      tokenHash: dashboardMagicTokenHash(token),
      sessionToken,
    });
    if (!result.ok) {
      res.status(401).json({ error: "dashboard link expired. text Azraj for a fresh one." });
      return;
    }
    res.json(result);
  });

  // Server-side session revocation. Without this a leaked token stays valid for
  // the full 30-day TTL with no way to kill it — "sign out" only cleared the
  // browser's copy. Always answers ok so the endpoint can't be used to probe
  // which tokens exist.
  router.post("/logout", async (req, res) => {
    const sessionToken = sessionTokenFromBody(req.body);
    if (sessionToken) {
      try {
        await convex.mutation(api.publicUsers.logout, { sessionToken });
      } catch (err) {
        console.error("[public-auth] logout failed", err);
      }
    }
    res.json({ ok: true });
  });

  return router;
}

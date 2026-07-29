import express from "express";
import { api } from "../convex/_generated/api.js";
import { convex } from "./convex-client.js";
import { outboundSmsAllowed } from "./sendblue.js";
import { buildSnapshot, evaluateConversation, nudgeEnabled } from "./nudge/service.js";
import { candidateNudges } from "./nudge/triggers.js";
import { NUDGE_KINDS, type NudgeKind } from "./nudge/types.js";

// Local QA surface for the proactive nudge engine. The loop only runs where
// outbound SMS is allowed, so these routes are how you exercise the pipeline
// from a dev machine: /status to see why nothing is firing, /check to run the
// real decision, /force to bypass the annoyance gate and read the generated text.
export function createNudgeRouter(): express.Router {
  const router = express.Router();

  // Why is (or isn't) a nudge due right now? Shows the snapshot the pure layer
  // sees plus every live candidate, which is usually enough to explain a quiet
  // engine without adding logging.
  router.get("/status", async (req, res) => {
    const conversationId = String(req.query.conversationId ?? "");
    if (!conversationId) {
      res.status(400).json({ error: "conversationId required" });
      return;
    }
    try {
      const [state, snapshot] = await Promise.all([
        convex.query(api.nudges.get, { conversationId }),
        buildSnapshot(conversationId),
      ]);
      res.json({
        enabled: nudgeEnabled(),
        outboundAllowed: outboundSmsAllowed(),
        state,
        snapshot,
        candidates: candidateNudges(snapshot),
      });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Run the real decision, annoyance rules included. Returns the skip reason
  // when policy declines, so a wrongly-quiet engine is diagnosable.
  router.post("/check", async (req, res) => {
    const conversationId = req.body?.conversationId;
    if (typeof conversationId !== "string" || !conversationId) {
      res.status(400).json({ error: "conversationId required" });
      return;
    }
    try {
      res.json(await evaluateConversation(conversationId));
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Bypass quiet hours, caps, and cooldowns, but NOT trigger detection — a
  // forced nudge still has to be about something that's genuinely true.
  router.post("/force", async (req, res) => {
    const conversationId = req.body?.conversationId;
    const kind = req.body?.kind;
    if (typeof conversationId !== "string" || !conversationId) {
      res.status(400).json({ error: "conversationId required" });
      return;
    }
    if (kind !== undefined && !NUDGE_KINDS.includes(kind as NudgeKind)) {
      res.status(400).json({ error: `kind must be one of: ${NUDGE_KINDS.join(", ")}` });
      return;
    }
    try {
      res.json(
        await evaluateConversation(conversationId, {
          force: true,
          ...(kind ? { kind: kind as NudgeKind } : {}),
        }),
      );
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  return router;
}

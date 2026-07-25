import express from "express";
import { api } from "../convex/_generated/api.js";
import { convex } from "./convex-client.js";
import { forceWeeklyDrop, forceWeeklyInsight, weeklyEnabled } from "./weekly/service.js";
import { generateWeekContent } from "./weekly/generate.js";

export function createWeeklyRouter(): express.Router {
  const router = express.Router();

  // Current schedule + this week's stored content for a conversation.
  router.get("/status", async (req, res) => {
    const conversationId = String(req.query.conversationId ?? "");
    const row = conversationId
      ? await convex.query(api.weeklyMindset.get, { conversationId })
      : null;
    res.json({ enabled: weeklyEnabled(), row });
  });

  // Preview the generated content WITHOUT sending it — for eyeballing the LLM
  // pass (challenge detection, person pick, verified article link).
  router.get("/preview", async (req, res) => {
    const conversationId = String(req.query.conversationId ?? "");
    if (!conversationId) {
      res.status(400).json({ error: "conversationId required" });
      return;
    }
    try {
      const content = await generateWeekContent({ conversationId });
      res.json({ content });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Force this week's drop now, bypassing the schedule — manual QA of the full
  // generate → deliver → record pipeline.
  router.post("/send", async (req, res) => {
    const conversationId = req.body?.conversationId;
    if (typeof conversationId !== "string" || !conversationId.startsWith("sms:")) {
      res.status(400).json({ error: "conversationId (sms:+…) required" });
      return;
    }
    try {
      const sent = await forceWeeklyDrop(conversationId);
      res.json({ ok: sent });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Force a specific mid-week insight now (QA of the insight path). Requires a
  // prior /weekly/send so this week's content exists. Body: { conversationId, index }.
  router.post("/insight", async (req, res) => {
    const conversationId = req.body?.conversationId;
    const index = Number(req.body?.index ?? 0);
    if (typeof conversationId !== "string" || !conversationId.startsWith("sms:")) {
      res.status(400).json({ error: "conversationId (sms:+…) required" });
      return;
    }
    try {
      const sent = await forceWeeklyInsight(conversationId, index);
      res.json({ ok: sent });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  return router;
}

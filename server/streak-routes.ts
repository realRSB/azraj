import express from "express";
import { api } from "../convex/_generated/api.js";
import { convex } from "./convex-client.js";
import { renderStreakCard, type StreakCardState } from "./streak/card.js";
import { sendStreakCard } from "./streak/service.js";
import { getUserTimezone } from "./timezone-config.js";

function dateLabel(timezone: string): string {
  const d = new Date();
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "long" }).format(d);
  const monthDay = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    month: "long",
    day: "numeric",
  }).format(d);
  return `${weekday} · ${monthDay}`;
}

export function createStreakRouter(): express.Router {
  const router = express.Router();

  // Live preview of a card as a PNG — handy for eyeballing in a browser.
  // e.g. /streak/preview.png?streak=9&state=alive  (or &scene=alpine-night)
  router.get("/preview.png", async (req, res) => {
    try {
      const streak = Number(req.query.streak ?? 9);
      const state = (String(req.query.state ?? "alive") as StreakCardState) || "alive";
      const longest = Number(req.query.longest ?? Math.max(streak, 1));
      const scene = typeof req.query.scene === "string" ? req.query.scene : undefined;
      const reset = req.query.reset === "true";
      const tz = await getUserTimezone();
      const { buffer, contentType } = await renderStreakCard({
        streak,
        longest,
        state,
        dateLabel: dateLabel(tz),
        seed: typeof req.query.seed === "string" ? req.query.seed : undefined,
        scene,
        usePhotos: req.query.photos !== "false",
        reset,
        format: req.query.format === "jpeg" ? "jpeg" : "png",
      });
      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "no-store");
      res.end(buffer);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Force-send today's card to a conversation now (bypasses the morning gate).
  // Body: { conversationId: "sms:+1…" }. For manual QA of the full pipeline.
  router.post("/send", async (req, res) => {
    const conversationId = req.body?.conversationId;
    if (typeof conversationId !== "string" || !conversationId.startsWith("sms:")) {
      res.status(400).json({ error: "conversationId (sms:+…) required" });
      return;
    }
    try {
      const row = await convex.query(api.streaks.get, { conversationId });
      if (!row) {
        res.status(404).json({ error: "no streak for that conversation yet" });
        return;
      }
      const sent = await sendStreakCard(row);
      res.json({ ok: sent });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  return router;
}

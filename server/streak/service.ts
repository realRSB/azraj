import { api } from "../../convex/_generated/api.js";
import { convex } from "../convex-client.js";
import { broadcast } from "../broadcast.js";
import { sendMms } from "../sendblue.js";
import { getUserTimezone } from "../timezone-config.js";
import { cardState } from "../../convex/streakLogic.js";
import { renderStreakCardPng, type StreakCardState } from "./card.js";

// Feature flags (env, read lazily so a restart isn't required to flip them in
// tests). Streaks are on by default; the morning card goes out at 8am local.
function streaksEnabled(): boolean {
  return process.env.BOOP_STREAK_ENABLED !== "false";
}
function morningHour(): number {
  const raw = Number(process.env.BOOP_STREAK_MORNING_HOUR);
  return Number.isInteger(raw) && raw >= 0 && raw <= 23 ? raw : 8;
}

interface LocalDay {
  isoDate: string; // YYYY-MM-DD in the given zone
  hour: number; // 0–23 in the given zone
}

function localDay(timezone: string): LocalDay {
  const d = new Date();
  const isoDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
  const hourStr = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    hourCycle: "h23",
  }).format(d);
  const hour = Number.parseInt(hourStr, 10) % 24;
  return { isoDate, hour: Number.isFinite(hour) ? hour : 0 };
}

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

// Register that the user texted today. Idempotent within a local day. Safe to
// call fire-and-forget on every inbound message — failures are swallowed so a
// streak hiccup never blocks a reply.
export async function touchStreak(conversationId: string): Promise<void> {
  if (!streaksEnabled()) return;
  try {
    const timezone = await getUserTimezone();
    const { isoDate } = localDay(timezone);
    await convex.mutation(api.streaks.touch, { conversationId, today: isoDate, timezone });
  } catch (err) {
    console.warn("[streak] touch failed", err);
  }
}

type StreakRow = {
  conversationId: string;
  currentStreak: number;
  longestStreak: number;
  lastActiveDate: string;
  timezone: string;
};

function caption(state: StreakCardState, streak: number, longest: number): string {
  if (state === "broken") {
    return longest > 1
      ? `streak reset — your best was ${longest}. let's rebuild it. 💪`
      : `new streak starts today. 💪`;
  }
  if (state === "today") return `🔥 ${streak} days strong. keep it going.`;
  return `🔥 ${streak}-day streak — text me today to keep it alive.`;
}

// Render the card, host it on Convex storage, and MMS it to the user. Returns
// true on a successful send. Only sms: conversations can receive an MMS.
export async function sendStreakCard(row: StreakRow): Promise<boolean> {
  if (!row.conversationId.startsWith("sms:")) return false;
  const number = row.conversationId.slice(4);
  const timezone = row.timezone || (await getUserTimezone());
  const { isoDate } = localDay(timezone);
  const { state, streak } = cardState(row.lastActiveDate, row.currentStreak, isoDate);

  const png = await renderStreakCardPng({
    streak,
    longest: row.longestStreak,
    state,
    dateLabel: dateLabel(timezone),
    seed: isoDate,
  });

  // Host the PNG on Convex storage (public CDN URL) so Sendblue can fetch it.
  const uploadUrl = await convex.mutation(api.messages.generateUploadUrl, {});
  const upload = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": "image/png" },
    // The fetch types accept ArrayBuffer (not a Node Buffer / typed-array
    // view), so hand over the exact bytes as a standalone ArrayBuffer.
    body: png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) as ArrayBuffer,
  });
  if (!upload.ok) {
    console.error(`[streak] storage upload failed: HTTP ${upload.status}`);
    return false;
  }
  const { storageId } = (await upload.json()) as { storageId: string };
  const mediaUrl = await convex.query(api.messages.getStorageUrl, {
    storageId: storageId as never,
  });
  if (!mediaUrl) {
    console.error("[streak] could not resolve storage URL for card");
    return false;
  }

  const text = caption(state, streak, row.longestStreak);
  const sent = await sendMms(number, mediaUrl, text);
  if (!sent) return false;

  // Mirror into the conversation so the debug UI shows the card, and mark it
  // sent so the loop doesn't re-send today.
  await convex.mutation(api.messages.send, {
    conversationId: row.conversationId,
    role: "assistant",
    content: text,
    imageStorageIds: [storageId as never],
  });
  await convex.mutation(api.streaks.markCardSent, {
    conversationId: row.conversationId,
    date: isoDate,
  });
  broadcast("streak_card", { conversationId: row.conversationId, streak, state });
  console.log(`[streak] sent ${state} card (${streak}) to ${row.conversationId}`);
  return true;
}

// Morning loop: once per local day, at/after the configured hour, send each
// user their card. Per-row timezone keeps the "morning" correct for each user
// even though the app is otherwise single-tenant.
export async function tickStreaks(): Promise<void> {
  if (!streaksEnabled()) return;
  const rows = (await convex.query(api.streaks.listAll, {})) as Array<
    StreakRow & { lastCardDate?: string }
  >;
  const hour = morningHour();
  for (const row of rows) {
    if (!row.conversationId.startsWith("sms:")) continue;
    try {
      const tz = row.timezone || (await getUserTimezone());
      const { isoDate, hour: localHour } = localDay(tz);
      if (localHour < hour) continue; // not morning yet in their zone
      if (row.lastCardDate === isoDate) continue; // already sent today
      await sendStreakCard(row);
    } catch (err) {
      console.error(`[streak] morning send failed for ${row.conversationId}`, err);
    }
  }
}

export function startStreakLoop(intervalMs = 60_000): () => void {
  const timer = setInterval(() => {
    tickStreaks().catch((err) => console.error("[streak] tick error", err));
  }, intervalMs);
  return () => clearInterval(timer);
}

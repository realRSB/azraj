import { api } from "../../convex/_generated/api.js";
import { convex } from "../convex-client.js";
import { broadcast } from "../broadcast.js";
import { sendMms } from "../sendblue.js";
import { getUserTimezone } from "../timezone-config.js";
import { cardState } from "../../convex/streakLogic.js";
import { renderStreakCard, type StreakCardState } from "./card.js";

// Streaks are on by default; set BOOP_STREAK_ENABLED=false to disable. Read
// lazily so flipping it in tests doesn't require a restart.
function streaksEnabled(): boolean {
  return process.env.BOOP_STREAK_ENABLED !== "false";
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

// Register that the user texted today, and — when that text advances the
// streak into a new local day — send the streak card right then. Idempotent
// within a local day: same-day repeats return advanced=false and send nothing,
// so the user gets exactly one card per day, the moment they first show up.
// Safe to call fire-and-forget on every inbound message; failures are swallowed
// so a streak hiccup never blocks a reply.
export async function touchStreak(conversationId: string): Promise<void> {
  if (!streaksEnabled()) return;
  try {
    const timezone = await getUserTimezone();
    const { isoDate } = localDay(timezone);
    const res = await convex.mutation(api.streaks.touch, {
      conversationId,
      today: isoDate,
      timezone,
    });
    // Reactive send: first-ever text, a consecutive-day extension, or a
    // comeback after a gap all set advanced=true. The card then reflects the
    // number they just earned (e.g. day 2's first text shows "2").
    if (res?.advanced && res.row) {
      await sendStreakCard(res.row as StreakRow, { reset: res.reset }).catch((err) =>
        console.error(`[streak] reactive send failed for ${conversationId}`, err),
      );
    }
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

function caption(
  state: StreakCardState,
  streak: number,
  longest: number,
  reset: boolean,
): string {
  if (reset) {
    return longest > 1
      ? `back at it 💪 your best was ${longest} — let's beat it.`
      : `back at it 💪 day one.`;
  }
  if (state === "broken") {
    return longest > 1
      ? `streak reset — your best was ${longest}. let's rebuild it. 💪`
      : `new streak starts today. 💪`;
  }
  const dayWord = streak === 1 ? "day" : "days";
  if (state === "today") return `🔥 ${streak} ${dayWord} strong. keep it going.`;
  return `🔥 ${streak}-day streak — text me today to keep it alive.`;
}

// Render the card, host it on Convex storage, and MMS it to the user. Returns
// true on a successful send. Only sms: conversations can receive an MMS.
export async function sendStreakCard(
  row: StreakRow,
  opts?: { reset?: boolean },
): Promise<boolean> {
  if (!row.conversationId.startsWith("sms:")) return false;
  const number = row.conversationId.slice(4);
  const timezone = row.timezone || (await getUserTimezone());
  const { isoDate } = localDay(timezone);
  const { state, streak } = cardState(row.lastActiveDate, row.currentStreak, isoDate);

  const { buffer: imageBytes, contentType } = await renderStreakCard({
    streak,
    longest: row.longestStreak,
    state,
    dateLabel: dateLabel(timezone),
    seed: isoDate,
    reset: opts?.reset,
    format: "jpeg",
  });

  // Host the image on Convex storage (public CDN URL) so Sendblue can fetch it.
  const uploadUrl = await convex.mutation(api.messages.generateUploadUrl, {});
  const upload = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": contentType },
    // The fetch types accept ArrayBuffer (not a Node Buffer / typed-array
    // view), so hand over the exact bytes as a standalone ArrayBuffer.
    body: imageBytes.buffer.slice(
      imageBytes.byteOffset,
      imageBytes.byteOffset + imageBytes.byteLength,
    ) as ArrayBuffer,
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

  const text = caption(state, streak, row.longestStreak, opts?.reset ?? false);
  const sent = await sendMms(number, mediaUrl, text);
  if (!sent) return false;

  // Mirror into the conversation so the debug UI shows the card, and record the
  // send date (surfaced in the debug UI; also a guard against a same-day resend).
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

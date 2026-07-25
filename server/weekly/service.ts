import { api } from "../../convex/_generated/api.js";
import { convex } from "../convex-client.js";
import { sendImessage } from "../sendblue.js";
import { getUserTimezone } from "../timezone-config.js";
import {
  currentSlotKey,
  dueInsightIndices,
  isDropDue,
  localParts,
  type WeeklyScheduleState,
} from "./schedule.js";
import { generateWeekContent, type WeekContent } from "./generate.js";

// Off by default — opt in per deployment. The onboarding ask goes out to
// engaged conversations, so it should never fire without an explicit choice.
export function weeklyEnabled(): boolean {
  return process.env.BOOP_WEEKLY_ENABLED === "true";
}

// Only onboard conversations that have actually engaged, so a one-off texter
// doesn't get the weekly pitch.
const ONBOARD_MIN_MESSAGES = 4;

export const ONBOARD_MESSAGE =
  `new weekly thing i'm adding for you: every week i'll send you a mindset + a "person of the week," ` +
  `picked from whatever you're working through, plus a few key ideas about them across the week. ` +
  `what day + time do you want it? (e.g. "sunday 7pm")`;

type WeeklyRow = {
  conversationId: string;
  timezone: string;
  status: "awaiting_schedule" | "active" | "disabled";
  preferredWeekday?: number | null;
  preferredHour?: number | null;
  lastDropSlot?: string | null;
  dropSentAt?: number | null;
  firstDropPending?: boolean | null;
  weekContent?: string | null;
  insightsSent?: boolean[] | null;
};

function formatDrop(c: WeekContent, first: boolean): string {
  const lead = first ? "kicking off something new with you 👊\n\n" : "";
  const article = c.article.url
    ? `📖 read this: ${c.article.name}\n${c.article.url}`
    : `📖 read this: ${c.article.name}`;
  return (
    `${lead}🧠 your week ahead\n\n` +
    `mindset: ${c.mindset}\n\n` +
    `person of the week: ${c.person}\n${c.why}\n\n` +
    `${article}\n\n` +
    `i'll send a few key things about ${c.person} through the week.`
  );
}

function formatInsight(c: WeekContent, index: number): string {
  const nugget = c.insights[index] ?? c.mindset;
  return `💡 ${c.person} — ${c.mindset}\n\n${nugget}`;
}

function parseContent(json: string | null | undefined): WeekContent | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as WeekContent;
  } catch {
    return null;
  }
}

// The person from last week's content, so the generator can avoid a back-to-back
// repeat.
function recentPersons(row: WeeklyRow): string[] {
  const prev = parseContent(row.weekContent);
  return prev?.person ? [prev.person] : [];
}

// Generate this week's content, deliver the drop, and record the anchor slot.
export async function sendWeeklyDrop(
  row: WeeklyRow,
  slotKey: string,
  first: boolean,
): Promise<boolean> {
  if (!row.conversationId.startsWith("sms:")) return false;
  const number = row.conversationId.slice(4);

  const content = await generateWeekContent({
    conversationId: row.conversationId,
    recentPersons: recentPersons(row),
  });
  if (!content) {
    console.warn(`[weekly] no content generated for ${row.conversationId}`);
    return false;
  }

  const text = formatDrop(content, first);
  await sendImessage(number, text);
  await convex.mutation(api.weeklyMindset.recordDrop, {
    conversationId: row.conversationId,
    slot: slotKey,
    weekContent: JSON.stringify(content),
  });
  // Mirror into the conversation log so the debug UI shows it.
  await convex.mutation(api.messages.send, {
    conversationId: row.conversationId,
    role: "assistant",
    content: text,
  });
  console.log(`[weekly] sent drop (${content.person}) to ${row.conversationId}`);
  return true;
}

async function sendWeeklyInsight(row: WeeklyRow, index: number): Promise<boolean> {
  const content = parseContent(row.weekContent);
  if (!content || !row.conversationId.startsWith("sms:")) return false;
  const number = row.conversationId.slice(4);
  const text = formatInsight(content, index);
  await sendImessage(number, text);
  await convex.mutation(api.weeklyMindset.markInsightSent, {
    conversationId: row.conversationId,
    index,
  });
  await convex.mutation(api.messages.send, {
    conversationId: row.conversationId,
    role: "assistant",
    content: text,
  });
  console.log(`[weekly] sent insight ${index + 1} to ${row.conversationId}`);
  return true;
}

// Send the onboarding ask to engaged sms conversations that don't have a weekly
// row yet. Idempotent via startOnboarding (returns created:false if present).
async function maybeOnboard(): Promise<void> {
  const [conversations, rows] = await Promise.all([
    convex.query(api.conversations.list, {}),
    convex.query(api.weeklyMindset.listAll, {}) as Promise<WeeklyRow[]>,
  ]);
  const known = new Set(rows.map((r) => r.conversationId));
  const tz = await getUserTimezone();
  for (const conv of conversations) {
    if (!conv.conversationId.startsWith("sms:")) continue;
    if (known.has(conv.conversationId)) continue;
    if ((conv.messageCount ?? 0) < ONBOARD_MIN_MESSAGES) continue;
    const res = await convex.mutation(api.weeklyMindset.startOnboarding, {
      conversationId: conv.conversationId,
      timezone: tz,
    });
    if (res.created) {
      const number = conv.conversationId.slice(4);
      await sendImessage(number, ONBOARD_MESSAGE);
      await convex.mutation(api.messages.send, {
        conversationId: conv.conversationId,
        role: "assistant",
        content: ONBOARD_MESSAGE,
      });
      console.log(`[weekly] onboarding ask sent to ${conv.conversationId}`);
    }
  }
}

// Once-per-tick sweep: onboarding asks, due drops, and due mid-week insights.
export async function tickWeekly(now = new Date()): Promise<void> {
  if (!weeklyEnabled()) return;
  try {
    await maybeOnboard();
  } catch (err) {
    console.error("[weekly] onboarding sweep failed", err);
  }

  const rows = (await convex.query(api.weeklyMindset.listAll, {})) as WeeklyRow[];
  for (const row of rows) {
    if (row.status !== "active") continue;
    if (!row.conversationId.startsWith("sms:")) continue;
    try {
      const tz = row.timezone || (await getUserTimezone());
      const parts = localParts(now, tz);
      const state: WeeklyScheduleState = {
        preferredWeekday: row.preferredWeekday,
        preferredHour: row.preferredHour,
        lastDropSlot: row.lastDropSlot,
        insightsSent: row.insightsSent ?? undefined,
      };
      if (isDropDue(state, parts)) {
        const slotKey = currentSlotKey(state, parts);
        if (slotKey) {
          const first = Boolean(row.firstDropPending) || !row.lastDropSlot;
          await sendWeeklyDrop(row, slotKey, first);
        }
      } else {
        for (const i of dueInsightIndices(
          { dropSentAt: row.dropSentAt, insightsSent: row.insightsSent },
          now.getTime(),
        )) {
          await sendWeeklyInsight(row, i);
        }
      }
    } catch (err) {
      console.error(`[weekly] tick failed for ${row.conversationId}`, err);
    }
  }
}

export function startWeeklyLoop(intervalMs = 5 * 60_000): () => void {
  const timer = setInterval(() => {
    tickWeekly().catch((err) => console.error("[weekly] tick error", err));
  }, intervalMs);
  return () => clearInterval(timer);
}

// Force this week's drop now, regardless of schedule — for manual QA via the
// /weekly/send route. Anchors to the current slot so the weekly cadence and
// insight timing pick up correctly afterward.
export async function forceWeeklyDrop(conversationId: string): Promise<boolean> {
  const row = (await convex.query(api.weeklyMindset.get, { conversationId })) as WeeklyRow | null;
  if (!row) return false;
  const tz = row.timezone || (await getUserTimezone());
  const parts = localParts(new Date(), tz);
  const state: WeeklyScheduleState = {
    preferredWeekday: row.preferredWeekday ?? parts.weekday,
    preferredHour: row.preferredHour ?? parts.hour,
    lastDropSlot: row.lastDropSlot,
  };
  const slotKey = currentSlotKey(state, parts) ?? new Date().toISOString().slice(0, 13);
  return sendWeeklyDrop(row, slotKey, !row.lastDropSlot);
}

// The loop that actually reaches out. Everything decision-shaped lives in
// triggers.ts and policy.ts; this file does I/O and nothing clever.
//
// Shape of one tick, per conversation:
//   1. load nudge bookkeeping
//   2. settle the previous nudge (did they reply, or did we get ignored?)
//   3. assemble a snapshot of real state
//   4. ask triggers what's worth saying, ask policy whether to say it
//   5. generate, send, mirror into history, advance the counters
//
// Off unless BOOP_NUDGE_ENABLED=true, matching startWeeklyLoop. An unprompted
// texting feature should never switch itself on by being merged.

import { api } from "../../convex/_generated/api.js";
import { convex } from "../convex-client.js";
import { broadcast } from "../broadcast.js";
import { outboundSmsAllowed, sendImessage, stripTells } from "../sendblue.js";
import { describeUserNow } from "../timezone-config.js";
import { localParts } from "../weekly/schedule.js";
import { generateNudge } from "./generate.js";
import { decideNudge, recordSendPatch, settleLastNudge } from "./policy.js";
import { candidateNudges } from "./triggers.js";
import {
  defaultNudgeState,
  type NudgeCandidate,
  type NudgeKind,
  type NudgeSnapshot,
  type NudgeState,
} from "./types.js";

export function nudgeEnabled(): boolean {
  return process.env.BOOP_NUDGE_ENABLED === "true";
}

const MESSAGE_SCAN = 40;

type NudgeRow = {
  intensity: NudgeState["intensity"];
  quietStartHour: number;
  quietEndHour: number;
  lastNudgeAt?: number;
  lastNudgeKind?: string;
  awaitingReply: boolean;
  countDate?: string;
  countToday: number;
  consecutiveIgnored: number;
  snoozeUntil?: number;
  kindLastSent: Record<string, number>;
};

// Convex stores absent values as missing fields; the pure layer models them as
// null. Both directions of that translation live here so nothing downstream has
// to care.
function rowToState(row: NudgeRow | null): NudgeState {
  if (!row) return defaultNudgeState();
  return {
    intensity: row.intensity,
    quietStartHour: row.quietStartHour,
    quietEndHour: row.quietEndHour,
    lastNudgeAt: row.lastNudgeAt ?? null,
    lastNudgeKind: (row.lastNudgeKind as NudgeKind | undefined) ?? null,
    awaitingReply: row.awaitingReply,
    countDate: row.countDate ?? null,
    countToday: row.countToday,
    consecutiveIgnored: row.consecutiveIgnored,
    snoozeUntil: row.snoozeUntil ?? null,
    kindLastSent: row.kindLastSent ?? {},
  };
}

async function saveState(conversationId: string, state: NudgeState): Promise<void> {
  await convex.mutation(api.nudges.save, {
    conversationId,
    intensity: state.intensity,
    quietStartHour: state.quietStartHour,
    quietEndHour: state.quietEndHour,
    ...(state.lastNudgeAt !== null ? { lastNudgeAt: state.lastNudgeAt } : {}),
    ...(state.lastNudgeKind !== null ? { lastNudgeKind: state.lastNudgeKind } : {}),
    awaitingReply: state.awaitingReply,
    ...(state.countDate !== null ? { countDate: state.countDate } : {}),
    countToday: state.countToday,
    consecutiveIgnored: state.consecutiveIgnored,
    ...(state.snoozeUntil !== null ? { snoozeUntil: state.snoozeUntil } : {}),
    kindLastSent: state.kindLastSent as Record<string, number>,
  });
}

async function loadState(conversationId: string): Promise<NudgeState> {
  const row = (await convex.query(api.nudges.get, { conversationId })) as NudgeRow | null;
  return rowToState(row);
}

interface PlanQueryResult {
  plan: { status?: string; lastProgressAt?: number };
  objectives: Array<{ text: string; status: string; updatedAt: number }>;
}

// Gather everything the pure layer is allowed to see. Sections are fetched
// concurrently, and each one degrades to an empty default rather than aborting
// the tick — a missing streak row must not cost the user a nudge about a stalled
// objective.
export async function buildSnapshot(
  conversationId: string,
  nowMs = Date.now(),
): Promise<NudgeSnapshot> {
  // Timezone and local date come from describeUserNow() specifically because
  // that is what accountability-tools.ts uses to key dailyPlans. Deriving the
  // date any other way risks looking up yesterday's plan near midnight.
  const now = await describeUserNow();
  const local = localParts(new Date(nowMs), now.timezone);

  const [messages, conversation, streak, plan] = await Promise.all([
    convex
      .query(api.messages.recent, { conversationId, limit: MESSAGE_SCAN })
      .catch(() => [] as Array<{ role: string; createdAt: number }>) as Promise<
      Array<{ role: string; createdAt: number }>
    >,
    convex
      .query(api.conversations.get, { conversationId })
      .catch(() => null) as Promise<{ messageCount?: number } | null>,
    convex
      .query(api.streaks.get, { conversationId })
      .catch(() => null) as Promise<{ currentStreak?: number; lastActiveDate?: string } | null>,
    convex
      .query(api.accountability.getDailyPlan, { conversationId, localDate: now.isoDate })
      .catch(() => null) as Promise<PlanQueryResult | null>,
  ]);

  const latest = (role: string): number | null => {
    const times = messages.filter((m) => m.role === role).map((m) => m.createdAt);
    return times.length ? Math.max(...times) : null;
  };

  return {
    conversationId,
    nowMs,
    local,
    localDate: now.isoDate,
    lastUserMessageAt: latest("user"),
    lastAssistantMessageAt: latest("assistant"),
    messageCount: conversation?.messageCount ?? messages.length,
    currentStreak: streak?.currentStreak ?? 0,
    lastActiveDate: streak?.lastActiveDate ?? null,
    plan: {
      exists: Boolean(plan),
      objectives: plan?.objectives ?? [],
      lastProgressAt: plan?.plan?.lastProgressAt ?? null,
      reviewed: plan?.plan?.status === "reviewed",
    },
  };
}

export type NudgeOutcome =
  | { status: "sent"; kind: NudgeKind; text: string }
  | { status: "dry_run"; kind: NudgeKind; text: string }
  | { status: "skipped"; reason: string }
  | { status: "generation_failed"; kind: NudgeKind }
  | { status: "send_failed"; kind: NudgeKind; text: string };

async function deliver(
  conversationId: string,
  candidate: NudgeCandidate,
  state: NudgeState,
  snapshot: NudgeSnapshot,
  localTime: string,
): Promise<NudgeOutcome> {
  const text = await generateNudge({ conversationId, candidate, localTime });
  if (!text) return { status: "generation_failed", kind: candidate.kind };

  // No real send possible: preview the text without touching counters or
  // history, so local QA can read what would have gone out.
  if (!conversationId.startsWith("sms:") || !outboundSmsAllowed()) {
    console.log(`[nudge] dry run (${candidate.kind}) for ${conversationId}: ${text}`);
    return { status: "dry_run", kind: candidate.kind, text };
  }

  const sent = await sendImessage(conversationId.slice(4), text);
  if (!sent) return { status: "send_failed", kind: candidate.kind, text };

  // Store the delivered form, not the raw generation, so history and iMessage
  // agree. sendImessage applies the same cleanup on its own path.
  await convex.mutation(api.messages.send, {
    conversationId,
    role: "assistant",
    content: stripTells(text),
  });
  await saveState(conversationId, { ...state, ...recordSendPatch(state, candidate, snapshot) });

  broadcast("nudge_sent", { conversationId, kind: candidate.kind });
  console.log(`[nudge] sent ${candidate.kind} to ${conversationId}`);
  return { status: "sent", kind: candidate.kind, text };
}

// One conversation's worth of work. Exported so the debug route and tests can
// drive a single conversation without waiting for a tick.
export async function evaluateConversation(
  conversationId: string,
  opts: { force?: boolean; kind?: NudgeKind } = {},
): Promise<NudgeOutcome> {
  const nowMs = Date.now();
  const [loaded, snapshot, now] = await Promise.all([
    loadState(conversationId),
    buildSnapshot(conversationId, nowMs),
    describeUserNow(),
  ]);

  // Score the previous nudge first, and persist that immediately — whether we
  // were ignored changes what this tick is allowed to do.
  const settled = settleLastNudge(loaded, snapshot);
  let state = { ...loaded, ...settled.patch };
  if (settled.outcome !== null) {
    await saveState(conversationId, state);
    console.log(`[nudge] last nudge ${settled.outcome} for ${conversationId}`);
  }

  const candidates = candidateNudges(snapshot);

  if (opts.force) {
    // QA path: bypass the annoyance gate but keep real trigger detection, so a
    // forced nudge still reflects genuine state. An explicit kind must actually
    // be live — faking one would test the generator against a fiction.
    const chosen = opts.kind
      ? candidates.find((c) => c.kind === opts.kind)
      : candidates[0];
    if (!chosen) {
      const live = candidates.map((c) => c.kind).join(", ") || "none";
      return {
        status: "skipped",
        reason: opts.kind
          ? `${opts.kind} is not currently true (live: ${live})`
          : "nothing worth saying",
      };
    }
    return deliver(conversationId, chosen, state, snapshot, now.hourMinute);
  }

  const decision = decideNudge(candidates, state, snapshot);
  if (decision.action === "skip") return { status: "skipped", reason: decision.reason };
  return deliver(conversationId, decision.candidate, state, snapshot, now.hourMinute);
}

let warnedOutboundBlocked = false;

export async function tickNudges(): Promise<void> {
  if (!nudgeEnabled()) return;

  // Without a delivery path every tick would generate text nobody receives,
  // burning model calls on nothing. Local QA goes through forceNudge instead.
  if (!outboundSmsAllowed()) {
    if (!warnedOutboundBlocked) {
      warnedOutboundBlocked = true;
      console.warn(
        "[nudge] loop idle — outbound SMS is blocked here. Use POST /nudge/check for a dry run.",
      );
    }
    return;
  }

  const conversations = (await convex.query(api.conversations.list, {})) as Array<{
    conversationId: string;
  }>;
  for (const conv of conversations) {
    if (!conv.conversationId.startsWith("sms:")) continue;
    try {
      const outcome = await evaluateConversation(conv.conversationId);
      if (outcome.status !== "skipped" && outcome.status !== "sent") {
        console.warn(`[nudge] ${conv.conversationId}: ${outcome.status}`);
      }
    } catch (err) {
      console.error(`[nudge] tick failed for ${conv.conversationId}`, err);
    }
  }
}

// Five minutes is well below the tightest min-gap, so the engine reacts to a
// situation within a few minutes of it becoming true without the tick rate
// itself ever being what decides whether a nudge goes out.
export function startNudgeLoop(intervalMs = 5 * 60_000): () => void {
  const timer = setInterval(() => {
    tickNudges().catch((err) => console.error("[nudge] tick error", err));
  }, intervalMs);
  return () => clearInterval(timer);
}

// Whether saying it right now would be annoying. Pure: no clock, no I/O.
//
// triggers.ts is optimistic by design — it reports every situation worth a text.
// This module is the pessimist, and it's the half that decides whether the
// feature feels like a coach or like a notification you mute. The rules that
// matter most:
//
//   - Yield to whatever already spoke. Min-gap is measured from the last
//     OUTBOUND message of any kind, so the existing cron check-ins, weekly
//     drops, streak cards, and ordinary replies all push nudges out. Two
//     systems texting about the same day is the worst outcome here.
//   - Being ignored is an answer. Unanswered nudges tighten the cap and then
//     buy progressively longer silence. He backs off without vanishing.
//   - One nudge per tick, ever. Situations stack; messages don't.

import type {
  NudgeCandidate,
  NudgeIntensity,
  NudgeSnapshot,
  NudgeState,
} from "./types.js";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

// Unprompted messages per local day, before any backoff.
const DAILY_CAP: Record<Exclude<NudgeIntensity, "off">, number> = {
  chill: 1,
  normal: 2,
  hard: 4,
};

// Minimum quiet time after ANY outbound message before a nudge may follow.
const MIN_GAP_MS: Record<Exclude<NudgeIntensity, "off">, number> = {
  chill: 8 * HOUR_MS,
  normal: 4 * HOUR_MS,
  hard: 2 * HOUR_MS,
};

// They texted this recently, so they're mid-conversation — a nudge would be
// talking over them.
const IN_CONVERSATION_MS = 45 * 60_000;

// One situation gets at most one message per day, so a stalled objective can't
// be raised three times before dinner.
const KIND_COOLDOWN_MS = 20 * HOUR_MS;

// How long to wait for a reply before scoring a nudge as ignored.
const REPLY_WINDOW_MS = 12 * HOUR_MS;

// Ignored-in-a-row thresholds: at 2 the daily cap drops to one, at 3 he goes
// quiet for a day and each further miss extends that.
const TIGHTEN_CAP_AT = 2;
const SNOOZE_AT = 3;
const MAX_SNOOZE_DAYS = 5;

export type SettleOutcome = "replied" | "ignored" | null;

export interface SettleResult {
  patch: Partial<NudgeState>;
  outcome: SettleOutcome;
}

// Score the previous nudge before deciding on a new one.
//
// A reply always clears the ignore streak, even if we'd already written the
// nudge off as ignored — someone answering 14 hours later is still engagement,
// and holding it against them would be the wrong read.
export function settleLastNudge(state: NudgeState, s: NudgeSnapshot): SettleResult {
  if (state.lastNudgeAt === null) return { patch: {}, outcome: null };

  const replied = s.lastUserMessageAt !== null && s.lastUserMessageAt > state.lastNudgeAt;
  if (replied) {
    if (!state.awaitingReply && state.consecutiveIgnored === 0 && state.snoozeUntil === null) {
      return { patch: {}, outcome: null }; // already settled as a reply
    }
    return {
      patch: { awaitingReply: false, consecutiveIgnored: 0, snoozeUntil: null },
      outcome: "replied",
    };
  }

  if (!state.awaitingReply) return { patch: {}, outcome: null };
  if (s.nowMs - state.lastNudgeAt < REPLY_WINDOW_MS) return { patch: {}, outcome: null };

  const consecutiveIgnored = state.consecutiveIgnored + 1;
  const snoozeDays = Math.min(consecutiveIgnored - SNOOZE_AT + 1, MAX_SNOOZE_DAYS);
  return {
    patch: {
      awaitingReply: false,
      consecutiveIgnored,
      ...(consecutiveIgnored >= SNOOZE_AT ? { snoozeUntil: s.nowMs + snoozeDays * DAY_MS } : {}),
    },
    outcome: "ignored",
  };
}

// Today's count, or zero when the stored counter belongs to an earlier local
// date. Scoping to the user's date (not the server's) is what makes the cap mean
// "per day where they live".
export function sentToday(state: NudgeState, localDate: string): number {
  return state.countDate === localDate ? state.countToday : 0;
}

export function effectiveDailyCap(state: NudgeState): number {
  if (state.intensity === "off") return 0;
  const base = DAILY_CAP[state.intensity];
  return state.consecutiveIgnored >= TIGHTEN_CAP_AT ? Math.min(base, 1) : base;
}

// True inside the user's allowed hours. Windows that wrap midnight are treated
// as spanning it, so quiet 22->9 keeps the small hours silent.
export function withinQuietHours(state: NudgeState, hour: number): boolean {
  const { quietStartHour: start, quietEndHour: end } = state;
  if (start === end) return false; // degenerate config: never speak
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

export type NudgeDecision =
  | { action: "send"; candidate: NudgeCandidate }
  | { action: "skip"; reason: string };

// The gate. Cheap, order-dependent checks first: most ticks exit on quiet hours
// or the min gap without touching candidate logic at all.
export function decideNudge(
  candidates: NudgeCandidate[],
  state: NudgeState,
  s: NudgeSnapshot,
): NudgeDecision {
  if (state.intensity === "off") return { action: "skip", reason: "nudges off" };
  if (!candidates.length) return { action: "skip", reason: "nothing worth saying" };

  if (state.snoozeUntil !== null && s.nowMs < state.snoozeUntil) {
    const hours = Math.ceil((state.snoozeUntil - s.nowMs) / HOUR_MS);
    return { action: "skip", reason: `snoozed for another ${hours}h after ignored nudges` };
  }

  if (!withinQuietHours(state, s.local.hour)) {
    return { action: "skip", reason: `quiet hours (local hour ${s.local.hour})` };
  }

  if (
    s.lastUserMessageAt !== null &&
    s.nowMs - s.lastUserMessageAt < IN_CONVERSATION_MS
  ) {
    return { action: "skip", reason: "user is mid-conversation" };
  }

  // Yield to every other outbound path, not just to previous nudges.
  const lastOutbound = Math.max(state.lastNudgeAt ?? 0, s.lastAssistantMessageAt ?? 0);
  const minGap = MIN_GAP_MS[state.intensity];
  if (lastOutbound > 0 && s.nowMs - lastOutbound < minGap) {
    const mins = Math.ceil((minGap - (s.nowMs - lastOutbound)) / 60_000);
    return { action: "skip", reason: `too soon after last outbound (${mins}m to go)` };
  }

  const cap = effectiveDailyCap(state);
  const already = sentToday(state, s.localDate);
  if (already >= cap) {
    return { action: "skip", reason: `daily cap reached (${already}/${cap})` };
  }

  // Cooldowns filter candidates rather than aborting the tick, so a stalled
  // objective raised this morning doesn't suppress an unrelated streak warning
  // tonight.
  const fresh = candidates.filter((c) => {
    const last = state.kindLastSent[c.kind];
    return last === undefined || s.nowMs - last >= KIND_COOLDOWN_MS;
  });
  if (!fresh.length) return { action: "skip", reason: "all candidate kinds on cooldown" };

  return { action: "send", candidate: fresh[0]! };
}

// State patch to apply after a nudge actually goes out. Separate from
// decideNudge so a send failure can't advance the counters.
export function recordSendPatch(
  state: NudgeState,
  candidate: NudgeCandidate,
  s: NudgeSnapshot,
): Partial<NudgeState> {
  return {
    lastNudgeAt: s.nowMs,
    lastNudgeKind: candidate.kind,
    awaitingReply: true,
    countDate: s.localDate,
    countToday: sentToday(state, s.localDate) + 1,
    kindLastSent: { ...state.kindLastSent, [candidate.kind]: s.nowMs },
  };
}

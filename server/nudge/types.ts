// Shared vocabulary for the proactive nudge engine.
//
// The engine answers one question on a timer: "given what I know about this
// person right now, is there something worth texting them about unprompted?"
// Two pure modules split that job — triggers.ts decides what's WORTH saying,
// policy.ts decides whether saying it right now would be annoying. Keeping them
// separate means the annoyance rules can be tuned without touching detection,
// and both unit-test without a clock or a database.

import type { LocalParts } from "../weekly/schedule.js";

export type { LocalParts };

// Ordered loosely by how much the user would thank you for it. Each kind maps
// to one recognizable situation, never to a time of day — a nudge that fires
// because the clock hit 13:00 is the annoying kind, and the cron check-ins in
// accountability-tools.ts already cover that ground.
export type NudgeKind =
  // They've dropped off entirely. Everything else is moot until they're back.
  | "ghosted"
  // A real streak is about to break and the day is nearly gone.
  | "streak_risk"
  // Evening, objectives still open, hours left to salvage something.
  | "last_call"
  // A specific objective has sat untouched for hours with runway remaining.
  | "stale_objective"
  // Mid-morning and they haven't committed to anything today.
  | "no_plan"
  // They closed something earlier and then went quiet with work still open.
  | "win_followup";

export const NUDGE_KINDS: readonly NudgeKind[] = [
  "ghosted",
  "streak_risk",
  "last_call",
  "stale_objective",
  "no_plan",
  "win_followup",
] as const;

export type NudgeIntensity = "off" | "chill" | "normal" | "hard";

export interface SnapshotObjective {
  text: string;
  // "pending" | "started" | "done" | "slipped" from convex/accountability.ts.
  // Kept as a plain string so a new status added there can't crash the loop.
  status: string;
  updatedAt: number;
}

// Everything the pure layer is allowed to know. The service assembles this from
// Convex once per conversation per tick; triggers and policy never do I/O, so
// every decision below is reproducible from this struct alone.
export interface NudgeSnapshot {
  conversationId: string;
  nowMs: number;
  local: LocalParts;
  // Today in the user's zone (YYYY-MM-DD), the key daily plans are stored under.
  localDate: string;

  // Conversation activity. `lastAssistantMessageAt` deliberately covers ALL
  // outbound — replies, cron check-ins, weekly drops, streak cards, past
  // nudges — because that is what makes the engine yield to the machinery that
  // already existed instead of talking over it.
  lastUserMessageAt: number | null;
  lastAssistantMessageAt: number | null;
  messageCount: number;

  currentStreak: number;
  // Local date of their most recent message, per the streaks table.
  lastActiveDate: string | null;

  plan: {
    exists: boolean;
    objectives: SnapshotObjective[];
    lastProgressAt: number | null;
    reviewed: boolean;
  };
}

export interface NudgeCandidate {
  kind: NudgeKind;
  // Higher wins when several situations are true at once. Only one nudge is
  // ever sent per tick — stacking them is how a coach becomes a group chat.
  priority: number;
  // The concrete thing this nudge is about, quoted into the generator prompt so
  // the text names it ("the calc problem set") instead of gesturing at "your
  // goals". This is most of what separates "he's watching" from a form letter.
  focus: string;
  // One line of situational brief for the generator: what's true, and why now.
  brief: string;
}

// Per-conversation nudge bookkeeping. Mirrors the `nudgeState` Convex table;
// the pure layer reads it and returns patches rather than writing.
export interface NudgeState {
  intensity: NudgeIntensity;
  // Nudges are allowed when quietEndHour > localHour >= quietStartHour, in the
  // user's zone. Defaults keep Azraj out of the early morning and late night.
  quietStartHour: number;
  quietEndHour: number;

  lastNudgeAt: number | null;
  lastNudgeKind: NudgeKind | null;
  // True while we're still waiting to learn whether the last nudge landed.
  // Settled exactly once, either by a reply or by a timeout (see policy.ts).
  awaitingReply: boolean;

  // Daily counter, scoped to a local date so it resets across midnight in the
  // user's zone rather than the server's.
  countDate: string | null;
  countToday: number;

  // How many nudges in a row went unanswered. Ignoring is signal, so this
  // tightens the cap and eventually buys silence.
  consecutiveIgnored: number;
  snoozeUntil: number | null;

  // Last send time per kind, so one situation can't nag twice in a day.
  kindLastSent: Partial<Record<NudgeKind, number>>;
}

export function defaultNudgeState(): NudgeState {
  return {
    intensity: "normal",
    quietStartHour: 9,
    quietEndHour: 22,
    lastNudgeAt: null,
    lastNudgeKind: null,
    awaitingReply: false,
    countDate: null,
    countToday: 0,
    consecutiveIgnored: 0,
    snoozeUntil: null,
    kindLastSent: {},
  };
}

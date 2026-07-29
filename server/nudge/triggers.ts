// What's worth texting about, unprompted. Pure: no clock, no I/O, no sends.
//
// Every rule here is state-derived, never clock-derived. The difference matters:
// "it's 1pm" produces the same message every day whether or not the user needs
// it, which is how a coach turns into an alarm you learn to ignore. "the thing
// you said you'd do at 9am hasn't moved and it's 3pm" only fires when it's
// actually true, so it lands as noticing rather than nagging.
//
// Each rule also refuses to fire outside the window where the user could
// plausibly act on it. Telling someone at 11pm that an objective is stalled is
// a complaint; telling them at 3pm is a nudge.

import type { NudgeCandidate, NudgeSnapshot, SnapshotObjective } from "./types.js";

const HOUR_MS = 3_600_000;

// Silence long enough that a coach who claims to be watching has to say
// something. Deliberately generous — a day off is a day off, not a lapse.
const GHOSTED_MS = 36 * HOUR_MS;
// Beyond this they aren't an active user, so only `ghosted` should speak.
const ACTIVE_USER_MS = 72 * HOUR_MS;
// How long an objective sits before "hasn't moved" is fair to say.
const STALE_OBJECTIVE_MS = 4 * HOUR_MS;
// A win is worth following up on for a day, but not in the same breath.
const WIN_FRESH_MS = 24 * HOUR_MS;
const WIN_SETTLE_MS = 3 * HOUR_MS;

const OPEN_STATUSES = new Set(["pending", "started"]);

function isOpen(o: SnapshotObjective): boolean {
  return OPEN_STATUSES.has(o.status);
}

function isDone(o: SnapshotObjective): boolean {
  return o.status === "done";
}

function hoursSince(nowMs: number, then: number): number {
  return Math.floor((nowMs - then) / HOUR_MS);
}

// Human-readable gap for the generator's brief. Azraj writes the actual text, so
// this only has to be accurate, not pretty.
function describeGap(nowMs: number, then: number): string {
  const hours = hoursSince(nowMs, then);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

// Truncate an objective so a rambling goal can't blow out the generator prompt.
function shortText(text: string, max = 90): string {
  const clean = text.trim().replace(/\s+/g, " ");
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

// The single most interesting stalled objective: oldest first, and a "started"
// one outranks an equally-old "pending" one. Something they began and abandoned
// is a sharper thing to raise than something they never touched.
function stalestOpen(objectives: SnapshotObjective[]): SnapshotObjective | null {
  const open = objectives.filter(isOpen);
  if (!open.length) return null;
  return [...open].sort((a, b) => {
    const startedDelta = Number(b.status === "started") - Number(a.status === "started");
    if (startedDelta !== 0) return startedDelta;
    return a.updatedAt - b.updatedAt;
  })[0]!;
}

function lastTouch(s: NudgeSnapshot): number | null {
  const times = [s.plan.lastProgressAt, ...s.plan.objectives.map((o) => o.updatedAt)].filter(
    (t): t is number => typeof t === "number" && t > 0,
  );
  return times.length ? Math.max(...times) : null;
}

// --- individual rules ----------------------------------------------------
// Each returns a candidate or null. They're independent by design: several can
// be true at once, and policy.ts picks exactly one to send.

// They've gone quiet for a day and a half. Fires regardless of whether a plan
// exists, because disappearing IS the thing worth noticing.
function ghosted(s: NudgeSnapshot): NudgeCandidate | null {
  if (s.lastUserMessageAt === null) return null;
  const silence = s.nowMs - s.lastUserMessageAt;
  if (silence < GHOSTED_MS) return null;

  const open = s.plan.objectives.filter(isOpen);
  const focus = open.length
    ? shortText(open[0]!.text)
    : "nothing specific on the table, just gone quiet";
  return {
    kind: "ghosted",
    priority: 100,
    focus,
    brief:
      `they haven't texted in ${describeGap(s.nowMs, s.lastUserMessageAt)}. ` +
      (open.length
        ? `last thing they committed to was "${shortText(open[0]!.text)}" and it's still open. `
        : "") +
      "re-open the door warmly. no guilt trip, no lecture about the silence.",
  };
}

// A streak worth protecting, no message yet today, and the day is nearly gone.
// Only fires in the evening: at 10am this is a threat about nothing.
function streakRisk(s: NudgeSnapshot): NudgeCandidate | null {
  if (s.currentStreak < 3) return null;
  if (s.lastActiveDate === s.localDate) return null; // already texted today
  if (s.local.hour < 19) return null;
  return {
    kind: "streak_risk",
    priority: 90,
    focus: `${s.currentStreak}-day streak`,
    brief:
      `their ${s.currentStreak}-day streak breaks if they don't text back today, and it's ` +
      `${s.local.hour}:00 their time. one line, low effort to answer, make the streak the hook.`,
  };
}

// Evening with objectives still open and the night review not done. This is the
// "you've still got a couple hours" window, not the post-mortem.
function lastCall(s: NudgeSnapshot): NudgeCandidate | null {
  if (!s.plan.exists || s.plan.reviewed) return null;
  if (s.local.hour < 18 || s.local.hour >= 22) return null;
  const open = s.plan.objectives.filter(isOpen);
  if (!open.length) return null;

  const named = open.slice(0, 2).map((o) => shortText(o.text, 60));
  return {
    kind: "last_call",
    priority: 70,
    focus: named.join(" / "),
    brief:
      `${open.length} objective${open.length === 1 ? "" : "s"} still open tonight: ` +
      `${named.map((t) => `"${t}"`).join(", ")}. it's ${s.local.hour}:00 their time. ` +
      "push for the smallest version of one of them, not all of it.",
  };
}

// The core "he's watching" nudge: a specific commitment hasn't moved in hours
// and there's still daytime left to move it.
function staleObjective(s: NudgeSnapshot): NudgeCandidate | null {
  if (!s.plan.exists || s.plan.reviewed) return null;
  if (s.local.hour < 11 || s.local.hour >= 18) return null;

  const target = stalestOpen(s.plan.objectives);
  if (!target) return null;
  const touched = lastTouch(s) ?? target.updatedAt;
  if (s.nowMs - touched < STALE_OBJECTIVE_MS) return null;

  const verb = target.status === "started" ? "started it and stopped" : "hasn't been touched";
  return {
    kind: "stale_objective",
    priority: 60,
    focus: shortText(target.text),
    brief:
      `"${shortText(target.text)}" ${verb} — nothing on the plan has moved in ` +
      `${describeGap(s.nowMs, touched)}, and it's ${s.local.hour}:00 their time so there's ` +
      "still runway. name that specific thing and ask for one concrete next move.",
  };
}

// Mid-morning, nothing committed to. Only for people who actually use this —
// a one-off texter shouldn't get chased for a daily plan.
function noPlan(s: NudgeSnapshot): NudgeCandidate | null {
  if (s.plan.exists) return null;
  if (s.local.hour < 10 || s.local.hour >= 15) return null;
  if (s.messageCount < 4) return null;
  if (s.lastUserMessageAt === null) return null;
  // Past this, they're ghosted, and that rule owns the conversation.
  if (s.nowMs - s.lastUserMessageAt >= ACTIVE_USER_MS) return null;

  return {
    kind: "no_plan",
    priority: 50,
    focus: "no plan set for today",
    brief:
      `it's ${s.local.hour}:00 their time and they haven't set anything for today. ` +
      "ask for one thing they're locking in, not a full plan. keep it easy to answer.",
  };
}

// They closed something, then went quiet with work still open. Leads with the
// win — this is the rule that keeps the engine from only ever showing up to
// complain.
function winFollowup(s: NudgeSnapshot): NudgeCandidate | null {
  if (!s.plan.exists || s.plan.reviewed) return null;
  if (s.local.hour < 12 || s.local.hour >= 22) return null;

  const done = s.plan.objectives.filter(isDone);
  const open = s.plan.objectives.filter(isOpen);
  if (!done.length || !open.length) return null;

  const touched = lastTouch(s);
  if (touched === null) return null;
  const idle = s.nowMs - touched;
  if (idle < WIN_SETTLE_MS || idle > WIN_FRESH_MS) return null;

  const win = shortText(done[done.length - 1]!.text, 60);
  const next = shortText(open[0]!.text, 60);
  return {
    kind: "win_followup",
    priority: 30,
    focus: `${win} → ${next}`,
    brief:
      `they finished "${win}" earlier and have been quiet for ` +
      `${describeGap(s.nowMs, touched)} with "${next}" still open. ` +
      "credit the win in a few words, then point at the next one. don't gush.",
  };
}

// All situations that are currently true, highest priority first. Returning the
// full list (rather than just the winner) keeps policy.ts able to skip a kind
// that's on cooldown and fall through to the next-best thing to say.
export function candidateNudges(s: NudgeSnapshot): NudgeCandidate[] {
  return [
    ghosted(s),
    streakRisk(s),
    lastCall(s),
    staleObjective(s),
    noPlan(s),
    winFollowup(s),
  ]
    .filter((c): c is NudgeCandidate => c !== null)
    .sort((a, b) => b.priority - a.priority);
}

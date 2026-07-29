import { describe, expect, it } from "vitest";
import {
  decideNudge,
  effectiveDailyCap,
  recordSendPatch,
  sentToday,
  settleLastNudge,
  withinQuietHours,
} from "../server/nudge/policy.js";
import {
  defaultNudgeState,
  type NudgeCandidate,
  type NudgeKind,
  type NudgeSnapshot,
  type NudgeState,
} from "../server/nudge/types.js";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 6, 29, 18, 0, 0);

function state(o: Partial<NudgeState> = {}): NudgeState {
  return { ...defaultNudgeState(), ...o };
}

// Defaults sit in the permissive middle so each test can break exactly one gate.
function snap(o: Partial<NudgeSnapshot> = {}): NudgeSnapshot {
  return {
    conversationId: "sms:+10000000000",
    nowMs: NOW,
    local: { year: 2026, month: 7, day: 29, hour: 14, minute: 0, weekday: 3 },
    localDate: "2026-07-29",
    lastUserMessageAt: NOW - 6 * HOUR,
    lastAssistantMessageAt: NOW - 6 * HOUR,
    messageCount: 40,
    currentStreak: 5,
    lastActiveDate: "2026-07-29",
    plan: { exists: false, objectives: [], lastProgressAt: null, reviewed: false },
    ...o,
  };
}

function cand(kind: NudgeKind, priority: number): NudgeCandidate {
  return { kind, priority, focus: "the thing", brief: "situational brief" };
}

const ONE = [cand("stale_objective", 60)];

describe("withinQuietHours", () => {
  it("allows the configured daytime window", () => {
    const s = state();
    expect(withinQuietHours(s, 9)).toBe(true);
    expect(withinQuietHours(s, 21)).toBe(true);
    expect(withinQuietHours(s, 8)).toBe(false);
    expect(withinQuietHours(s, 22)).toBe(false);
  });

  it("handles a window that wraps midnight", () => {
    const night = state({ quietStartHour: 22, quietEndHour: 9 });
    expect(withinQuietHours(night, 23)).toBe(true);
    expect(withinQuietHours(night, 3)).toBe(true);
    expect(withinQuietHours(night, 12)).toBe(false);
  });

  it("treats an empty window as never", () => {
    expect(withinQuietHours(state({ quietStartHour: 9, quietEndHour: 9 }), 9)).toBe(false);
  });
});

describe("decideNudge", () => {
  it("sends when nothing objects", () => {
    const d = decideNudge(ONE, state(), snap());
    expect(d).toEqual({ action: "send", candidate: ONE[0] });
  });

  it("respects being switched off", () => {
    const d = decideNudge(ONE, state({ intensity: "off" }), snap());
    expect(d.action).toBe("skip");
  });

  it("says nothing when no situation is live", () => {
    expect(decideNudge([], state(), snap()).action).toBe("skip");
  });

  it("holds off outside quiet hours", () => {
    const d = decideNudge(ONE, state(), snap({ local: { ...snap().local, hour: 7 } }));
    expect(d).toMatchObject({ action: "skip" });
    expect(d.action === "skip" && d.reason).toContain("quiet hours");
  });

  it("does not talk over a live conversation", () => {
    const d = decideNudge(ONE, state(), snap({ lastUserMessageAt: NOW - 10 * 60_000 }));
    expect(d.action === "skip" && d.reason).toContain("mid-conversation");
  });

  // The coexistence guarantee: the existing cron check-ins, weekly drops, and
  // streak cards all land in the messages table as assistant rows, so they push
  // the next nudge out exactly like a nudge would.
  it("yields to any recent outbound message, not just to past nudges", () => {
    const justCheckedIn = snap({
      lastUserMessageAt: NOW - 6 * HOUR,
      lastAssistantMessageAt: NOW - HOUR,
    });
    const d = decideNudge(ONE, state(), justCheckedIn);
    expect(d.action === "skip" && d.reason).toContain("too soon after last outbound");
  });

  it("sends once the gap since the last outbound has passed", () => {
    const d = decideNudge(ONE, state(), snap({ lastAssistantMessageAt: NOW - 5 * HOUR }));
    expect(d.action).toBe("send");
  });

  it("scales the required gap with intensity", () => {
    const threeHoursAgo = snap({ lastAssistantMessageAt: NOW - 3 * HOUR });
    expect(decideNudge(ONE, state({ intensity: "chill" }), threeHoursAgo).action).toBe("skip");
    expect(decideNudge(ONE, state({ intensity: "hard" }), threeHoursAgo).action).toBe("send");
  });

  it("enforces the daily cap", () => {
    const maxed = state({ countDate: "2026-07-29", countToday: 2 });
    const d = decideNudge(ONE, maxed, snap());
    expect(d.action === "skip" && d.reason).toContain("daily cap");
  });

  it("resets the daily counter across the user's midnight", () => {
    const yesterday = state({ countDate: "2026-07-28", countToday: 9 });
    expect(sentToday(yesterday, "2026-07-29")).toBe(0);
    expect(decideNudge(ONE, yesterday, snap()).action).toBe("send");
  });

  it("stays snoozed after being ignored repeatedly", () => {
    const snoozed = state({ snoozeUntil: NOW + 6 * HOUR });
    const d = decideNudge(ONE, snoozed, snap());
    expect(d.action === "skip" && d.reason).toContain("snoozed");
  });

  it("skips a kind on cooldown and falls through to the next best thing", () => {
    const cooled = state({ kindLastSent: { ghosted: NOW - 2 * HOUR } });
    const d = decideNudge([cand("ghosted", 100), cand("no_plan", 50)], cooled, snap());
    expect(d).toMatchObject({ action: "send" });
    expect(d.action === "send" && d.candidate.kind).toBe("no_plan");
  });

  it("stays quiet when every live situation was already raised today", () => {
    const cooled = state({ kindLastSent: { ghosted: NOW - 2 * HOUR, no_plan: NOW - HOUR } });
    const d = decideNudge([cand("ghosted", 100), cand("no_plan", 50)], cooled, snap());
    expect(d.action === "skip" && d.reason).toContain("cooldown");
  });

  it("lets a kind through again the next day", () => {
    const cooled = state({ kindLastSent: { stale_objective: NOW - 21 * HOUR } });
    expect(decideNudge(ONE, cooled, snap()).action).toBe("send");
  });
});

describe("effectiveDailyCap", () => {
  it("follows intensity", () => {
    expect(effectiveDailyCap(state({ intensity: "chill" }))).toBe(1);
    expect(effectiveDailyCap(state({ intensity: "normal" }))).toBe(2);
    expect(effectiveDailyCap(state({ intensity: "hard" }))).toBe(4);
    expect(effectiveDailyCap(state({ intensity: "off" }))).toBe(0);
  });

  it("tightens to one a day once two nudges in a row are ignored", () => {
    expect(effectiveDailyCap(state({ intensity: "hard", consecutiveIgnored: 2 }))).toBe(1);
  });
});

describe("settleLastNudge", () => {
  const sent = state({ lastNudgeAt: NOW - 2 * HOUR, awaitingReply: true, consecutiveIgnored: 1 });

  it("does nothing before the first nudge", () => {
    expect(settleLastNudge(state(), snap()).outcome).toBeNull();
  });

  it("clears the ignore streak when they reply", () => {
    const r = settleLastNudge(sent, snap({ lastUserMessageAt: NOW - HOUR }));
    expect(r.outcome).toBe("replied");
    expect(r.patch).toMatchObject({ awaitingReply: false, consecutiveIgnored: 0, snoozeUntil: null });
  });

  it("forgives a late reply that arrives after we scored it ignored", () => {
    const written = state({ lastNudgeAt: NOW - 20 * HOUR, awaitingReply: false, consecutiveIgnored: 2 });
    const r = settleLastNudge(written, snap({ lastUserMessageAt: NOW - HOUR }));
    expect(r.outcome).toBe("replied");
    expect(r.patch.consecutiveIgnored).toBe(0);
  });

  it("waits out the reply window before judging", () => {
    expect(settleLastNudge(sent, snap({ lastUserMessageAt: NOW - 3 * HOUR })).outcome).toBeNull();
  });

  it("counts silence as ignored once the window closes", () => {
    const stale = state({ lastNudgeAt: NOW - 13 * HOUR, awaitingReply: true });
    const r = settleLastNudge(stale, snap({ lastUserMessageAt: NOW - 20 * HOUR }));
    expect(r.outcome).toBe("ignored");
    expect(r.patch.consecutiveIgnored).toBe(1);
    expect(r.patch.snoozeUntil).toBeUndefined();
  });

  it("buys a day of silence at the third miss, and longer after that", () => {
    const third = settleLastNudge(
      state({ lastNudgeAt: NOW - 13 * HOUR, awaitingReply: true, consecutiveIgnored: 2 }),
      snap({ lastUserMessageAt: NOW - 40 * HOUR }),
    );
    expect(third.patch.snoozeUntil).toBe(NOW + DAY);

    const fourth = settleLastNudge(
      state({ lastNudgeAt: NOW - 13 * HOUR, awaitingReply: true, consecutiveIgnored: 3 }),
      snap({ lastUserMessageAt: NOW - 60 * HOUR }),
    );
    expect(fourth.patch.snoozeUntil).toBe(NOW + 2 * DAY);
  });

  it("caps the backoff so he never disappears for good", () => {
    const r = settleLastNudge(
      state({ lastNudgeAt: NOW - 13 * HOUR, awaitingReply: true, consecutiveIgnored: 20 }),
      snap({ lastUserMessageAt: NOW - 400 * HOUR }),
    );
    expect(r.patch.snoozeUntil).toBe(NOW + 5 * DAY);
  });

  it("settles only once for the same nudge", () => {
    const settled = state({ lastNudgeAt: NOW - 30 * HOUR, awaitingReply: false, consecutiveIgnored: 1 });
    expect(settleLastNudge(settled, snap({ lastUserMessageAt: NOW - 40 * HOUR })).outcome).toBeNull();
  });
});

describe("recordSendPatch", () => {
  it("stamps the send and advances today's counter", () => {
    const patch = recordSendPatch(state({ countDate: "2026-07-29", countToday: 1 }), ONE[0]!, snap());
    expect(patch).toMatchObject({
      lastNudgeAt: NOW,
      lastNudgeKind: "stale_objective",
      awaitingReply: true,
      countDate: "2026-07-29",
      countToday: 2,
    });
    expect(patch.kindLastSent).toEqual({ stale_objective: NOW });
  });

  it("starts a fresh counter on a new local day and keeps other cooldowns", () => {
    const patch = recordSendPatch(
      state({ countDate: "2026-07-28", countToday: 4, kindLastSent: { ghosted: 123 } }),
      ONE[0]!,
      snap(),
    );
    expect(patch.countToday).toBe(1);
    expect(patch.kindLastSent).toEqual({ ghosted: 123, stale_objective: NOW });
  });
});

import { describe, expect, it } from "vitest";
import { candidateNudges } from "../server/nudge/triggers.js";
import type { NudgeKind, NudgeSnapshot, SnapshotObjective } from "../server/nudge/types.js";

const HOUR = 3_600_000;
// Fixed instant so every "hours ago" below is exact. The local clock is supplied
// separately via `local`, so nothing here depends on the host timezone.
const NOW = Date.UTC(2026, 6, 29, 18, 0, 0);

function snap(o: Partial<NudgeSnapshot> = {}): NudgeSnapshot {
  return {
    conversationId: "sms:+10000000000",
    nowMs: NOW,
    local: { year: 2026, month: 7, day: 29, hour: 14, minute: 0, weekday: 3 },
    localDate: "2026-07-29",
    lastUserMessageAt: NOW - 2 * HOUR,
    lastAssistantMessageAt: NOW - 2 * HOUR,
    messageCount: 40,
    currentStreak: 5,
    lastActiveDate: "2026-07-29",
    plan: { exists: false, objectives: [], lastProgressAt: null, reviewed: false },
    ...o,
  };
}

function obj(o: Partial<SnapshotObjective> = {}): SnapshotObjective {
  return { text: "finish calc problem set", status: "pending", updatedAt: NOW - 6 * HOUR, ...o };
}

function kinds(s: NudgeSnapshot): NudgeKind[] {
  return candidateNudges(s).map((c) => c.kind);
}

describe("ghosted", () => {
  it("fires after a day and a half of silence", () => {
    expect(kinds(snap({ lastUserMessageAt: NOW - 40 * HOUR }))).toContain("ghosted");
  });

  it("stays quiet for a normal day off", () => {
    expect(kinds(snap({ lastUserMessageAt: NOW - 24 * HOUR }))).not.toContain("ghosted");
  });

  it("never fires for someone who has never texted", () => {
    expect(kinds(snap({ lastUserMessageAt: null }))).toEqual([]);
  });

  it("names the still-open commitment when there is one", () => {
    const c = candidateNudges(
      snap({
        lastUserMessageAt: NOW - 40 * HOUR,
        plan: {
          exists: true,
          objectives: [obj({ text: "ship the landing page" })],
          lastProgressAt: null,
          reviewed: false,
        },
      }),
    ).find((x) => x.kind === "ghosted");
    expect(c?.focus).toBe("ship the landing page");
    expect(c?.brief).toContain("ship the landing page");
  });
});

describe("streak_risk", () => {
  const atRisk = { currentStreak: 5, lastActiveDate: "2026-07-28" };

  it("fires in the evening when a real streak is unclaimed today", () => {
    expect(kinds(snap({ ...atRisk, local: { ...snap().local, hour: 20 } }))).toContain(
      "streak_risk",
    );
  });

  it("does not threaten the streak in the afternoon", () => {
    expect(kinds(snap({ ...atRisk, local: { ...snap().local, hour: 14 } }))).not.toContain(
      "streak_risk",
    );
  });

  it("ignores streaks too short to care about", () => {
    expect(
      kinds(snap({ currentStreak: 2, lastActiveDate: "2026-07-28", local: { ...snap().local, hour: 20 } })),
    ).not.toContain("streak_risk");
  });

  it("stays quiet once they have already texted today", () => {
    expect(
      kinds(snap({ currentStreak: 5, lastActiveDate: "2026-07-29", local: { ...snap().local, hour: 20 } })),
    ).not.toContain("streak_risk");
  });
});

describe("last_call", () => {
  const evening = { ...snap().local, hour: 19 };
  const openPlan = {
    exists: true,
    objectives: [obj({ status: "started" }), obj({ text: "read 20 pages" })],
    lastProgressAt: NOW - 6 * HOUR,
    reviewed: false,
  };

  it("fires in the evening with objectives still open", () => {
    expect(kinds(snap({ local: evening, plan: openPlan }))).toContain("last_call");
  });

  it("waits until evening", () => {
    expect(kinds(snap({ local: { ...snap().local, hour: 15 }, plan: openPlan }))).not.toContain(
      "last_call",
    );
  });

  it("goes quiet once the night review is recorded", () => {
    expect(
      kinds(snap({ local: evening, plan: { ...openPlan, reviewed: true } })),
    ).not.toContain("last_call");
  });

  it("goes quiet when everything is done", () => {
    expect(
      kinds(
        snap({
          local: evening,
          plan: { ...openPlan, objectives: [obj({ status: "done" })] },
        }),
      ),
    ).not.toContain("last_call");
  });
});

describe("stale_objective", () => {
  const stalePlan = {
    exists: true,
    objectives: [obj({ updatedAt: NOW - 6 * HOUR })],
    lastProgressAt: NOW - 6 * HOUR,
    reviewed: false,
  };

  it("fires when nothing has moved for hours and the day has runway", () => {
    expect(kinds(snap({ plan: stalePlan }))).toContain("stale_objective");
  });

  it("stays quiet when the plan was touched recently", () => {
    expect(
      kinds(
        snap({
          plan: {
            ...stalePlan,
            objectives: [obj({ updatedAt: NOW - HOUR })],
            lastProgressAt: NOW - HOUR,
          },
        }),
      ),
    ).not.toContain("stale_objective");
  });

  it("hands the evening over to last_call", () => {
    expect(kinds(snap({ local: { ...snap().local, hour: 19 }, plan: stalePlan }))).not.toContain(
      "stale_objective",
    );
  });

  it("quotes the specific objective, preferring one they started and abandoned", () => {
    const c = candidateNudges(
      snap({
        plan: {
          exists: true,
          objectives: [
            obj({ text: "email the professor", status: "pending", updatedAt: NOW - 9 * HOUR }),
            obj({ text: "outline chapter 3", status: "started", updatedAt: NOW - 5 * HOUR }),
          ],
          lastProgressAt: NOW - 5 * HOUR,
          reviewed: false,
        },
      }),
    ).find((x) => x.kind === "stale_objective");
    expect(c?.focus).toBe("outline chapter 3");
    expect(c?.brief).toContain("started it and stopped");
  });
});

describe("no_plan", () => {
  const midMorning = { ...snap().local, hour: 11 };

  it("fires mid-morning for an engaged user with nothing set", () => {
    expect(kinds(snap({ local: midMorning }))).toContain("no_plan");
  });

  it("does not chase a one-off texter", () => {
    expect(kinds(snap({ local: midMorning, messageCount: 2 }))).not.toContain("no_plan");
  });

  it("gives up on the day by mid-afternoon", () => {
    expect(kinds(snap({ local: { ...snap().local, hour: 16 } }))).not.toContain("no_plan");
  });

  it("defers to ghosted once they have been gone for days", () => {
    const k = kinds(snap({ local: midMorning, lastUserMessageAt: NOW - 80 * HOUR }));
    expect(k).toContain("ghosted");
    expect(k).not.toContain("no_plan");
  });

  it("stays quiet when a plan exists", () => {
    expect(
      kinds(
        snap({
          local: midMorning,
          plan: { exists: true, objectives: [obj()], lastProgressAt: null, reviewed: false },
        }),
      ),
    ).not.toContain("no_plan");
  });
});

describe("win_followup", () => {
  const mixedPlan = {
    exists: true,
    objectives: [obj({ text: "gym", status: "done" }), obj({ text: "revise essay" })],
    lastProgressAt: NOW - 5 * HOUR,
    reviewed: false,
  };

  it("fires after a win goes quiet with work still open", () => {
    const c = candidateNudges(snap({ plan: mixedPlan })).find((x) => x.kind === "win_followup");
    expect(c).toBeDefined();
    expect(c?.brief).toContain("gym");
    expect(c?.brief).toContain("revise essay");
  });

  it("lets the win breathe before following up", () => {
    expect(
      kinds(snap({ plan: { ...mixedPlan, lastProgressAt: NOW - HOUR } })),
    ).not.toContain("win_followup");
  });

  // Staleness is measured from the last time ANYTHING on the plan moved, so
  // ageing the plan means ageing the objectives too — updateProgress patches
  // both together, and a snapshot where they disagree can't occur.
  it("stops following up on activity older than a day", () => {
    expect(
      kinds(
        snap({
          plan: {
            ...mixedPlan,
            objectives: [
              obj({ text: "gym", status: "done", updatedAt: NOW - 30 * HOUR }),
              obj({ text: "revise essay", updatedAt: NOW - 30 * HOUR }),
            ],
            lastProgressAt: NOW - 30 * HOUR,
          },
        }),
      ),
    ).not.toContain("win_followup");
  });

  it("needs an actual win to lead with", () => {
    expect(
      kinds(snap({ plan: { ...mixedPlan, objectives: [obj(), obj({ text: "revise essay" })] } })),
    ).not.toContain("win_followup");
  });
});

describe("candidate ordering", () => {
  it("puts disappearing ahead of everything else", () => {
    const k = kinds(
      snap({
        lastUserMessageAt: NOW - 50 * HOUR,
        currentStreak: 9,
        lastActiveDate: "2026-07-27",
        local: { ...snap().local, hour: 20 },
        plan: {
          exists: true,
          objectives: [obj({ status: "done" }), obj({ text: "revise essay" })],
          lastProgressAt: NOW - 6 * HOUR,
          reviewed: false,
        },
      }),
    );
    expect(k.length).toBeGreaterThan(1);
    expect(k[0]).toBe("ghosted");
  });

  it("finds nothing to say on a well-run day", () => {
    expect(
      kinds(
        snap({
          plan: {
            exists: true,
            objectives: [obj({ status: "done" }), obj({ status: "done", text: "gym" })],
            lastProgressAt: NOW - 30 * 60_000,
            reviewed: false,
          },
        }),
      ),
    ).toEqual([]);
  });
});

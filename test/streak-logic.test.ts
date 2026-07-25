import { describe, expect, it } from "vitest";
import { advanceStreak, cardState, dayDiff } from "../convex/streakLogic.js";

describe("dayDiff", () => {
  it("computes whole-day differences", () => {
    expect(dayDiff("2026-07-22", "2026-07-23")).toBe(1);
    expect(dayDiff("2026-07-23", "2026-07-23")).toBe(0);
    expect(dayDiff("2026-07-23", "2026-07-22")).toBe(-1);
    expect(dayDiff("2026-07-01", "2026-07-31")).toBe(30);
  });

  it("crosses month and year boundaries", () => {
    expect(dayDiff("2026-06-30", "2026-07-01")).toBe(1);
    expect(dayDiff("2025-12-31", "2026-01-01")).toBe(1);
    // Leap year: Feb 29 exists in 2028.
    expect(dayDiff("2028-02-28", "2028-03-01")).toBe(2);
    expect(dayDiff("2027-02-28", "2027-03-01")).toBe(1);
  });
});

describe("advanceStreak", () => {
  const base = {
    currentStreak: 8,
    longestStreak: 12,
    totalDays: 40,
    lastActiveDate: "2026-07-22",
  };

  it("starts a first-ever streak at 1", () => {
    expect(advanceStreak(null, "2026-07-23")).toEqual({
      currentStreak: 1,
      longestStreak: 1,
      totalDays: 1,
      changed: true,
      reset: false,
    });
  });

  it("is a no-op on the same day (idempotent per local day)", () => {
    const next = advanceStreak(base, "2026-07-22");
    expect(next.changed).toBe(false);
    expect(next.currentStreak).toBe(8);
    expect(next.totalDays).toBe(40);
  });

  it("is a no-op when the clock runs backwards", () => {
    const next = advanceStreak(base, "2026-07-21");
    expect(next.changed).toBe(false);
    expect(next.currentStreak).toBe(8);
  });

  it("extends the streak on a consecutive day", () => {
    const next = advanceStreak(base, "2026-07-23");
    expect(next).toEqual({
      currentStreak: 9,
      longestStreak: 12,
      totalDays: 41,
      changed: true,
      reset: false,
    });
  });

  it("updates longestStreak when the current run passes it", () => {
    const next = advanceStreak(
      { ...base, currentStreak: 12, longestStreak: 12 },
      "2026-07-23",
    );
    expect(next.currentStreak).toBe(13);
    expect(next.longestStreak).toBe(13);
  });

  it("resets to 1 after a missed day, keeping longest + totalDays", () => {
    const next = advanceStreak(base, "2026-07-25");
    expect(next).toEqual({
      currentStreak: 1,
      longestStreak: 12,
      totalDays: 41,
      changed: true,
      reset: true,
    });
  });

  it("flags reset only on a gap, not on an extension or first day", () => {
    expect(advanceStreak(null, "2026-07-23").reset).toBe(false);
    expect(advanceStreak(base, "2026-07-23").reset).toBe(false); // consecutive
    expect(advanceStreak(base, "2026-07-25").reset).toBe(true); // 2-day gap
  });

  it("builds a 9-day streak from 9 consecutive days of texting", () => {
    let state: Parameters<typeof advanceStreak>[0] = null;
    for (let day = 1; day <= 9; day++) {
      const today = `2026-07-${String(day).padStart(2, "0")}`;
      const next = advanceStreak(state, today);
      state = {
        currentStreak: next.currentStreak,
        longestStreak: next.longestStreak,
        totalDays: next.totalDays,
        lastActiveDate: today,
      };
    }
    expect(state?.currentStreak).toBe(9);
    expect(state?.longestStreak).toBe(9);
    expect(state?.totalDays).toBe(9);
  });
});

describe("cardState", () => {
  it("shows the current streak when the user already texted today", () => {
    expect(cardState("2026-07-23", 9, "2026-07-23")).toEqual({
      state: "today",
      streak: 9,
    });
  });

  it("shows an alive streak the morning after activity", () => {
    expect(cardState("2026-07-22", 9, "2026-07-23")).toEqual({
      state: "alive",
      streak: 9,
    });
  });

  it("shows broken once a full day was missed", () => {
    expect(cardState("2026-07-21", 9, "2026-07-23")).toEqual({
      state: "broken",
      streak: 0,
    });
  });
});

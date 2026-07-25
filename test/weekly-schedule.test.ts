import { describe, expect, it } from "vitest";
import {
  currentSlot,
  describeSlot,
  dueInsightIndices,
  isDropDue,
  type LocalParts,
  localParts,
  parseTimeToHour,
  parseWeekday,
} from "../server/weekly/schedule.js";

// Build LocalParts directly so the slot math is tested without a real clock.
function parts(o: Partial<LocalParts>): LocalParts {
  return { year: 2026, month: 7, day: 29, hour: 10, minute: 0, weekday: 3, ...o };
}

describe("parseWeekday", () => {
  it("parses full names, abbreviations, and prefixes", () => {
    expect(parseWeekday("Sunday")).toBe(0);
    expect(parseWeekday("sun")).toBe(0);
    expect(parseWeekday("monday")).toBe(1);
    expect(parseWeekday("wed")).toBe(3);
    expect(parseWeekday("Thursday")).toBe(4);
    expect(parseWeekday("thurs")).toBe(4);
    expect(parseWeekday("sat")).toBe(6);
  });
  it("returns null for junk", () => {
    expect(parseWeekday("someday")).toBeNull();
    expect(parseWeekday("")).toBeNull();
  });
});

describe("parseTimeToHour", () => {
  it("parses 12h, 24h, and words", () => {
    expect(parseTimeToHour("7pm")).toBe(19);
    expect(parseTimeToHour("7:30pm")).toBe(19);
    expect(parseTimeToHour("19")).toBe(19);
    expect(parseTimeToHour("19:00")).toBe(19);
    expect(parseTimeToHour("9am")).toBe(9);
    expect(parseTimeToHour("12am")).toBe(0);
    expect(parseTimeToHour("12pm")).toBe(12);
    expect(parseTimeToHour("noon")).toBe(12);
    expect(parseTimeToHour("midnight")).toBe(0);
  });
  it("rejects out-of-range / junk", () => {
    expect(parseTimeToHour("25")).toBeNull();
    expect(parseTimeToHour("13pm")).toBeNull();
    expect(parseTimeToHour("abc")).toBeNull();
  });
});

describe("describeSlot", () => {
  it("renders a friendly slot label", () => {
    expect(describeSlot(0, 19)).toBe("Sundays at 7pm");
    expect(describeSlot(1, 9)).toBe("Mondays at 9am");
    expect(describeSlot(3, 12)).toBe("Wednesdays at 12pm");
    expect(describeSlot(6, 0)).toBe("Saturdays at 12am");
  });
});

describe("currentSlot", () => {
  it("finds the most recent preferred weekday/hour", () => {
    // Wed the 29th, preferred Monday@9 -> 2 days back to Mon the 27th.
    const slot = currentSlot(parts({ weekday: 3 }), 1, 9);
    expect(slot.key).toBe("2026-07-27T09");
  });
  it("rolls back a full week when today is the slot day but before the hour", () => {
    // Monday the 27th at 8am, preferred Monday@9 -> slot is last Monday (20th).
    const slot = currentSlot(parts({ day: 27, weekday: 1, hour: 8 }), 1, 9);
    expect(slot.key).toBe("2026-07-20T09");
  });
});

describe("isDropDue", () => {
  const p = parts({ day: 29, weekday: 3, hour: 10 }); // Wed 10am
  const thisWeeksSlot = currentSlot(p, 1, 9).key; // Mon the 27th

  it("is due when this week's slot has not been dropped", () => {
    expect(isDropDue({ preferredWeekday: 1, preferredHour: 9, lastDropSlot: null }, p)).toBe(true);
    expect(
      isDropDue({ preferredWeekday: 1, preferredHour: 9, lastDropSlot: "2026-07-20T09" }, p),
    ).toBe(true);
  });
  it("is not due once this week's slot has been dropped", () => {
    expect(
      isDropDue({ preferredWeekday: 1, preferredHour: 9, lastDropSlot: thisWeeksSlot }, p),
    ).toBe(false);
  });
  it("is not due without a schedule", () => {
    expect(isDropDue({ preferredWeekday: null, preferredHour: null }, p)).toBe(false);
  });
});

describe("dueInsightIndices", () => {
  const DAY = 86_400_000;
  const drop = Date.UTC(2026, 6, 27, 13, 0); // drop moment (arbitrary)
  const state = { dropSentAt: drop, insightsSent: [false, false, false] };

  it("releases insight 0 two days after the drop", () => {
    expect(dueInsightIndices(state, drop + 2 * DAY)).toEqual([0]);
  });
  it("holds insight 0 until two full days pass", () => {
    expect(dueInsightIndices(state, drop + 2 * DAY - 1)).toEqual([]);
  });
  it("releases 0 and 1 by day four, skipping already-sent ones", () => {
    expect(dueInsightIndices(state, drop + 4 * DAY)).toEqual([0, 1]);
    expect(
      dueInsightIndices({ ...state, insightsSent: [true, false, false] }, drop + 4 * DAY),
    ).toEqual([1]);
  });
  it("releases all three by day six", () => {
    expect(dueInsightIndices(state, drop + 6 * DAY)).toEqual([0, 1, 2]);
  });
  it("returns nothing before any drop", () => {
    expect(dueInsightIndices({ dropSentAt: null, insightsSent: [false, false, false] }, drop)).toEqual([]);
  });
});

describe("localParts (tz integration)", () => {
  it("reads local calendar parts in the target zone", () => {
    // 2026-07-29T02:30Z is still 2026-07-28 22:30 in New York (EDT, -4).
    const p = localParts(new Date("2026-07-29T02:30:00Z"), "America/New_York");
    expect({ year: p.year, month: p.month, day: p.day, hour: p.hour }).toEqual({
      year: 2026,
      month: 7,
      day: 28,
      hour: 22,
    });
    expect(p.weekday).toBe(2); // Tuesday
  });
});

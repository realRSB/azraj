import { describe, expect, it } from "vitest";
import {
  accountabilityAutomationSpecs,
  cronForLocalTime,
  normalizeLocalTime,
} from "../server/accountability-tools.js";
import { INTERACTION_SYSTEM } from "../server/interaction-agent.js";

describe("accountability daily contract tools", () => {
  it("normalizes local times into daily cron schedules", () => {
    expect(normalizeLocalTime("1pm")).toBe("13:00");
    expect(normalizeLocalTime("9:30 PM")).toBe("21:30");
    expect(normalizeLocalTime("00:05")).toBe("00:05");

    expect(cronForLocalTime("13:30")).toBe("30 13 * * *");
    expect(cronForLocalTime("9pm")).toBe("0 21 * * *");
    expect(cronForLocalTime("25:00")).toBe(null);
  });

  it("defines the default Azraj check-in rhythm", () => {
    const specs = accountabilityAutomationSpecs({});
    expect(specs.map((spec) => spec.name)).toEqual([
      "azraj midday check-in",
      "azraj evening progress",
      "azraj night review",
    ]);
    expect(specs.map((spec) => spec.time)).toEqual(["13:00", "17:00", "21:00"]);
    expect(specs.every((spec) => spec.task.includes("lowercase"))).toBe(true);
    expect(specs.every((spec) => spec.task.includes("iMessage-short"))).toBe(true);
  });

  it("makes structured accountability state part of the dispatcher contract", () => {
    expect(INTERACTION_SYSTEM).toContain("use create_daily_contract before replying");
    expect(INTERACTION_SYSTEM).toContain("use get_daily_contract");
    expect(INTERACTION_SYSTEM).toContain("use update_daily_progress");
    expect(INTERACTION_SYSTEM).toContain("use record_night_review");
    expect(INTERACTION_SYSTEM).toContain("default recurring midday, evening, and night check-ins");
  });
});

import { describe, expect, it } from "vitest";
import { isSameAutomationName, normalizeAutomationName } from "../server/automation-tools.js";

describe("automation name dedup", () => {
  it("normalizes case and punctuation to a stable key", () => {
    expect(normalizeAutomationName("SAT R&W module check-in!")).toBe("sat r w module check in");
    expect(normalizeAutomationName("  Azraj   Midday  Check-In ")).toBe("azraj midday check in");
  });

  it("treats trivially-different labels as the same automation", () => {
    // hyphen vs space, and case — the exact pile-up that spammed the user.
    expect(isSameAutomationName("SAT R&W module check-in", "SAT R&W module check in")).toBe(true);
    expect(isSameAutomationName("azraj midday check-in", "Azraj Midday Check-In")).toBe(true);
  });

  it("keeps genuinely different tasks separate", () => {
    expect(
      isSameAutomationName("SAT R&W module check-in", "SAT practice test 8 check-in"),
    ).toBe(false);
    expect(isSameAutomationName("morning workout", "evening workout")).toBe(false);
  });
});

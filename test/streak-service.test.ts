import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock every I/O dependency of the streak service so we can assert the
// reactive-send DECISION in isolation: does touchStreak() actually fire the
// card when the day advances, and stay silent on same-day repeats?
vi.mock("../server/convex-client.js", () => ({
  convex: { mutation: vi.fn(), query: vi.fn() },
}));
vi.mock("../server/sendblue.js", () => ({ sendMms: vi.fn() }));
vi.mock("../server/timezone-config.js", () => ({ getUserTimezone: vi.fn() }));
vi.mock("../server/streak/card.js", () => ({ renderStreakCard: vi.fn() }));
vi.mock("../server/broadcast.js", () => ({ broadcast: vi.fn() }));

import { getFunctionName } from "convex/server";
import { convex } from "../server/convex-client.js";
import { sendMms } from "../server/sendblue.js";
import { getUserTimezone } from "../server/timezone-config.js";
import { renderStreakCard } from "../server/streak/card.js";
import { touchStreak } from "../server/streak/service.js";

const CONV = "sms:+15550000123";

function row(overrides: Record<string, unknown> = {}) {
  return {
    conversationId: CONV,
    currentStreak: 2,
    longestStreak: 2,
    lastActiveDate: "2026-07-24",
    timezone: "America/New_York",
    ...overrides,
  };
}

// Point convex.mutation/query at sensible defaults for the whole send pipeline,
// with `touch` returning whatever the test wants to simulate. Matched on the
// function NAME ("file:export") — Convex's generated `api` proxy doesn't return
// a stable object per access, so reference-identity comparison wouldn't match.
function wireConvex(touchResult: unknown) {
  vi.mocked(convex.mutation).mockImplementation(async (fn: Parameters<typeof convex.mutation>[0]) => {
    const name = getFunctionName(fn);
    if (name === "streaks:touch") return touchResult;
    if (name === "messages:generateUploadUrl") return "https://upload.test/put";
    return undefined; // messages:send, streaks:markCardSent
  });
  vi.mocked(convex.query).mockImplementation(async (fn: Parameters<typeof convex.query>[0]) => {
    if (getFunctionName(fn) === "messages:getStorageUrl") return "https://cdn.test/card.jpg";
    return undefined;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.BOOP_STREAK_ENABLED;
  vi.mocked(getUserTimezone).mockResolvedValue("America/New_York");
  vi.mocked(renderStreakCard).mockResolvedValue({
    buffer: Buffer.from([1, 2, 3]),
    contentType: "image/jpeg",
  });
  vi.mocked(sendMms).mockResolvedValue(true);
  // Storage upload POST.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ storageId: "storage-1" }), { status: 200 })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("touchStreak reactive send", () => {
  it("sends the card on the first message of a new day (advanced)", async () => {
    wireConvex({ advanced: true, row: row(), reset: false });

    await touchStreak(CONV);

    expect(sendMms).toHaveBeenCalledTimes(1);
    const [number, mediaUrl] = vi.mocked(sendMms).mock.calls[0];
    expect(number).toBe("+15550000123");
    expect(mediaUrl).toBe("https://cdn.test/card.jpg");
  });

  it("stays silent on a same-day repeat (not advanced)", async () => {
    wireConvex({ advanced: false, row: row(), reset: false });

    await touchStreak(CONV);

    expect(sendMms).not.toHaveBeenCalled();
  });

  it("sends a comeback card when a gap reset the streak (advanced + reset)", async () => {
    wireConvex({ advanced: true, row: row({ currentStreak: 1 }), reset: true });

    await touchStreak(CONV);

    expect(sendMms).toHaveBeenCalledTimes(1);
    const [, , caption] = vi.mocked(sendMms).mock.calls[0];
    expect(typeof caption).toBe("string");
    expect((caption as string).length).toBeGreaterThan(0);
  });

  it("does nothing when streaks are disabled", async () => {
    process.env.BOOP_STREAK_ENABLED = "false";
    wireConvex({ advanced: true, row: row(), reset: false });

    await touchStreak(CONV);

    expect(convex.mutation).not.toHaveBeenCalled();
    expect(sendMms).not.toHaveBeenCalled();
  });
});

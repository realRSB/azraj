import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { outboundSmsAllowed, sendImessage, sendMms } from "../server/sendblue.js";

// A dev box running the full pipeline can text the real user for real (/chat,
// debug UI, a streak touch, an automation tick). That actually happened: a local
// test turn pushed an unwanted streak card to the user's phone. These tests lock
// the gate so only a real deployment — or an explicit opt-in — can send.

const saved = { ...process.env };

beforeEach(() => {
  process.env.SENDBLUE_API_KEY = "test-key";
  process.env.SENDBLUE_API_SECRET = "test-secret";
  process.env.SENDBLUE_FROM_NUMBER = ["+", "1", "555", "000", "0100"].join("");
  delete process.env.BOOP_ALLOW_OUTBOUND_SMS;
  delete process.env.PUBLIC_URL;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  process.env = { ...saved };
});

const RECIPIENT = ["+", "1", "555", "000", "0101"].join("");

function stubFetch() {
  const mock = vi.fn(async () => new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", mock);
  return mock;
}

describe("outbound SMS guard", () => {
  it("blocks sends from local dev (PUBLIC_URL is localhost)", async () => {
    process.env.PUBLIC_URL = "http://localhost:3456";
    const fetchMock = stubFetch();
    vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(outboundSmsAllowed()).toBe(false);
    await sendImessage(RECIPIENT, "hello");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("blocks sends when PUBLIC_URL is unset", async () => {
    const fetchMock = stubFetch();
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await sendImessage(RECIPIENT, "hello");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("blocks MMS too, and reports failure to the caller", async () => {
    process.env.PUBLIC_URL = "http://localhost:3456";
    const fetchMock = stubFetch();
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const sent = await sendMms(RECIPIENT, "https://cdn.test/card.jpg", "caption");
    expect(sent).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allows sends from a real deployment (non-localhost PUBLIC_URL)", async () => {
    process.env.PUBLIC_URL = "https://azraj.example.app";
    const fetchMock = stubFetch();

    expect(outboundSmsAllowed()).toBe(true);
    await sendImessage(RECIPIENT, "hello");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("allows sends when a developer explicitly opts in", async () => {
    process.env.PUBLIC_URL = "http://localhost:3456";
    process.env.BOOP_ALLOW_OUTBOUND_SMS = "true";
    const fetchMock = stubFetch();

    expect(outboundSmsAllowed()).toBe(true);
    await sendImessage(RECIPIENT, "hello");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("honors an explicit opt-out even on a deployment", async () => {
    process.env.PUBLIC_URL = "https://azraj.example.app";
    process.env.BOOP_ALLOW_OUTBOUND_SMS = "false";
    const fetchMock = stubFetch();
    vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(outboundSmsAllowed()).toBe(false);
    await sendImessage(RECIPIENT, "hello");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

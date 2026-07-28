import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeE164, sendImessage } from "../server/sendblue.js";

const originalApiKey = process.env.SENDBLUE_API_KEY;
const originalApiSecret = process.env.SENDBLUE_API_SECRET;
const originalFromNumber = process.env.SENDBLUE_FROM_NUMBER;
const originalAllowOutbound = process.env.BOOP_ALLOW_OUTBOUND_SMS;

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalAllowOutbound === undefined) {
    delete process.env.BOOP_ALLOW_OUTBOUND_SMS;
  } else {
    process.env.BOOP_ALLOW_OUTBOUND_SMS = originalAllowOutbound;
  }
  if (originalApiKey === undefined) {
    delete process.env.SENDBLUE_API_KEY;
  } else {
    process.env.SENDBLUE_API_KEY = originalApiKey;
  }
  if (originalApiSecret === undefined) {
    delete process.env.SENDBLUE_API_SECRET;
  } else {
    process.env.SENDBLUE_API_SECRET = originalApiSecret;
  }
  if (originalFromNumber === undefined) {
    delete process.env.SENDBLUE_FROM_NUMBER;
  } else {
    process.env.SENDBLUE_FROM_NUMBER = originalFromNumber;
  }
});

describe("sendImessage", () => {
  it("normalizes phone numbers for public user conversation identity", () => {
    expect(normalizeE164("7862139361")).toBe("+17862139361");
    expect(normalizeE164("17862139361")).toBe("+17862139361");
    expect(normalizeE164("+17862139361")).toBe("+17862139361");
  });

  it("redacts phone numbers from the delivered message body", async () => {
    process.env.SENDBLUE_API_KEY = "test-key";
    process.env.SENDBLUE_API_SECRET = "test-secret";
    process.env.SENDBLUE_FROM_NUMBER = ["+", "1", "555", "000", "0100"].join("");
    // Outbound is gated to real deployments (see server/sendblue.ts); opt in so
    // this test can exercise the actual send path.
    process.env.BOOP_ALLOW_OUTBOUND_SMS = "true";
    const recipient = ["+", "1", "555", "000", "0101"].join("");
    const leakedPhone = ["+", "1", "555", "555", "0102"].join("");
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const sent = await sendImessage(recipient, `Call ${leakedPhone}`);

    expect(sent).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({
      number: recipient,
      content: "Call [phone number hidden]",
    });
  });

  it("reports send failure when Sendblue rejects the request", async () => {
    process.env.SENDBLUE_API_KEY = "test-key";
    process.env.SENDBLUE_API_SECRET = "test-secret";
    process.env.SENDBLUE_FROM_NUMBER = ["+", "1", "555", "000", "0100"].join("");
    process.env.BOOP_ALLOW_OUTBOUND_SMS = "true";
    const recipient = ["+", "1", "555", "000", "0101"].join("");
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ status: "ERROR" }), { status: 400 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});

    const sent = await sendImessage(recipient, "hello");

    expect(sent).toBe(false);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

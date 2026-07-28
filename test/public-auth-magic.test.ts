import { afterEach, describe, expect, it, vi } from "vitest";
import {
  dashboardLinkIntent,
  dashboardMagicMessage,
  dashboardMagicTokenHash,
  dashboardMagicUrl,
  extractJoinCode,
  joinCodeHash,
  joinMessage,
} from "../server/public-auth-magic.js";

describe("public auth magic links", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("builds dashboard links against the public web url", () => {
    vi.stubEnv("PUBLIC_WEB_URL", "https://azraj.tech/");

    expect(dashboardMagicUrl("tok_123")).toBe("https://azraj.tech/dashboard?login=tok_123");
  });

  it("hashes tokens with the auth secret", () => {
    vi.stubEnv("PUBLIC_AUTH_SECRET", "secret-one");
    const first = dashboardMagicTokenHash("tok_123");
    vi.stubEnv("PUBLIC_AUTH_SECRET", "secret-two");
    const second = dashboardMagicTokenHash("tok_123");

    expect(first).toHaveLength(64);
    expect(second).toHaveLength(64);
    expect(first).not.toBe(second);
  });

  it("detects dashboard link requests without triggering every old user message", () => {
    expect(dashboardLinkIntent("send me my dashboard link", false)).toBe("command");
    expect(dashboardLinkIntent("send me my dashboard link", true)).toBe(null);
    expect(dashboardLinkIntent("yo azraj, help me plan today.", true)).toBe(null);
    expect(dashboardLinkIntent("yo azraj, help me plan today.", false)).toBe(null);
  });

  it("builds and extracts bracketed join codes", () => {
    expect(joinMessage("63paol7")).toBe("I'm ready to join Azraj [63PAOL7]!");
    expect(extractJoinCode("I'm ready to join Azraj [63PAOL7]!")).toBe("63PAOL7");
    expect(extractJoinCode("no code here")).toBe(null);
  });

  it("hashes join codes with the auth secret", () => {
    vi.stubEnv("PUBLIC_AUTH_SECRET", "secret-one");
    const first = joinCodeHash("63paol7");
    vi.stubEnv("PUBLIC_AUTH_SECRET", "secret-two");
    const second = joinCodeHash("63PAOL7");

    expect(first).toHaveLength(64);
    expect(second).toHaveLength(64);
    expect(first).not.toBe(second);
  });

  it("keeps link messages short and clear", () => {
    expect(dashboardMagicMessage("https://azraj.tech/dashboard?login=x", "command")).toContain(
      "expires in 10 min",
    );
    expect(dashboardMagicMessage("https://azraj.tech/dashboard?login=x", "welcome")).toContain(
      "today's 3 wins",
    );
  });
});

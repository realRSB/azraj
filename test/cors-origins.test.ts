import { describe, expect, it } from "vitest";
import { buildCorsOrigins } from "../server/cors-origins.js";

describe("buildCorsOrigins", () => {
  it("always includes the local dev origins", () => {
    const origins = buildCorsOrigins({});
    expect(origins).toContain("http://localhost:3456");
    expect(origins).toContain("http://localhost:5173");
    expect(origins).toContain("http://localhost:5174");
  });

  it("does not open up to arbitrary origins by default", () => {
    const origins = buildCorsOrigins({});
    expect(origins).not.toContain("*");
    expect(origins.some((o) => o.includes("evil.example.com"))).toBe(false);
  });

  it("adds the deployed origin when PUBLIC_URL is a real deployment", () => {
    const origins = buildCorsOrigins({ PUBLIC_URL: "https://azraj.tech" });
    expect(origins).toContain("https://azraj.tech");
  });

  it("normalizes to origin only, dropping any path on PUBLIC_URL", () => {
    const origins = buildCorsOrigins({ PUBLIC_URL: "https://azraj.tech/some/path" });
    expect(origins).toContain("https://azraj.tech");
    expect(origins.some((o) => o.includes("/some/path"))).toBe(false);
  });

  it("does not add a local PUBLIC_URL as an extra origin", () => {
    const origins = buildCorsOrigins({ PUBLIC_URL: "http://localhost:3456" });
    expect(origins).toEqual(["http://localhost:3456", "http://localhost:5173", "http://localhost:5174"]);
  });

  it("ignores a malformed PUBLIC_URL instead of throwing", () => {
    expect(() => buildCorsOrigins({ PUBLIC_URL: "not a url" })).not.toThrow();
    const origins = buildCorsOrigins({ PUBLIC_URL: "not a url" });
    expect(origins).toEqual(["http://localhost:3456", "http://localhost:5173", "http://localhost:5174"]);
  });
});

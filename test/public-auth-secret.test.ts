import { afterEach, describe, expect, it, vi } from "vitest";

// Regression coverage for the OTP-hash key-hygiene fix: real deployments must
// set PUBLIC_AUTH_SECRET explicitly rather than silently hashing login codes
// with SENDBLUE_API_SECRET (a different secret, used elsewhere), or
// CONVEX_DEPLOYMENT (not a secret — a deployment slug that ends up in URLs
// and logs), or a shared static fallback.
describe("public auth secret", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("uses PUBLIC_AUTH_SECRET when set, real deployment or not", async () => {
    vi.stubEnv("PUBLIC_AUTH_SECRET", "explicit-secret");
    vi.stubEnv("PUBLIC_URL", "https://azraj.tech");
    const { assertPublicAuthSecretConfigured } = await import("../server/public-auth-routes.js");
    expect(() => assertPublicAuthSecretConfigured()).not.toThrow();
  });

  it("falls back quietly on local dev (PUBLIC_URL unset)", async () => {
    vi.stubEnv("PUBLIC_AUTH_SECRET", "");
    vi.stubEnv("PUBLIC_URL", "");
    const { assertPublicAuthSecretConfigured } = await import("../server/public-auth-routes.js");
    expect(() => assertPublicAuthSecretConfigured()).not.toThrow();
  });

  it("falls back quietly on local dev (PUBLIC_URL is localhost)", async () => {
    vi.stubEnv("PUBLIC_AUTH_SECRET", "");
    vi.stubEnv("PUBLIC_URL", "http://localhost:3456");
    const { assertPublicAuthSecretConfigured } = await import("../server/public-auth-routes.js");
    expect(() => assertPublicAuthSecretConfigured()).not.toThrow();
  });

  it("refuses to boot when PUBLIC_URL is a real deployment and the secret is missing", async () => {
    vi.stubEnv("PUBLIC_AUTH_SECRET", "");
    vi.stubEnv("PUBLIC_URL", "https://azraj.tech");
    const { assertPublicAuthSecretConfigured } = await import("../server/public-auth-routes.js");
    expect(() => assertPublicAuthSecretConfigured()).toThrow(/PUBLIC_AUTH_SECRET is required/);
  });

  it("never silently reuses SENDBLUE_API_SECRET or CONVEX_DEPLOYMENT as the key on a real deployment", async () => {
    vi.stubEnv("PUBLIC_AUTH_SECRET", "");
    vi.stubEnv("SENDBLUE_API_SECRET", "some-other-secret");
    vi.stubEnv("CONVEX_DEPLOYMENT", "dev:foo-bar-123");
    vi.stubEnv("PUBLIC_URL", "https://azraj.tech");
    const { assertPublicAuthSecretConfigured } = await import("../server/public-auth-routes.js");
    expect(() => assertPublicAuthSecretConfigured()).toThrow(/PUBLIC_AUTH_SECRET is required/);
  });
});

import type { IncomingHttpHeaders } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { isPublicServerRequest } from "../server/local-access.js";
import { applySecurityHeaders } from "../server/http-security.js";
import { devCodePayload } from "../server/public-auth-routes.js";

function request({
  headers = {},
  method = "POST",
  remoteAddress = "203.0.113.10",
  url = "/api/public-auth/logout",
}: {
  headers?: IncomingHttpHeaders;
  method?: string;
  remoteAddress?: string;
  url?: string;
} = {}) {
  return {
    headers: { host: "azraj.tech", ...headers },
    method,
    socket: { remoteAddress },
    url,
  } as Parameters<typeof isPublicServerRequest>[0];
}

const ORIGINAL_OTP_ECHO = process.env.BOOP_DEV_OTP_ECHO;

afterEach(() => {
  if (ORIGINAL_OTP_ECHO === undefined) delete process.env.BOOP_DEV_OTP_ECHO;
  else process.env.BOOP_DEV_OTP_ECHO = ORIGINAL_OTP_ECHO;
});

describe("public auth surface", () => {
  it("exposes logout so a leaked session can be revoked", () => {
    expect(isPublicServerRequest(request({ url: "/api/public-auth/logout" }))).toBe(true);
    expect(isPublicServerRequest(request({ url: "/public-auth/logout" }))).toBe(true);
  });

  it("still refuses everything outside the allowlist", () => {
    expect(isPublicServerRequest(request({ url: "/api/public-auth/logout", method: "GET" }))).toBe(
      false,
    );
    expect(isPublicServerRequest(request({ url: "/chat" }))).toBe(false);
    expect(isPublicServerRequest(request({ url: "/runtime-config", method: "GET" }))).toBe(false);
    expect(isPublicServerRequest(request({ url: "/composio/connections" }))).toBe(false);
  });
});

describe("dev OTP echo", () => {
  // Regression guard for the auth bypass: the login code must never ride back
  // in the HTTP response unless someone explicitly opted in.
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

  afterEach(() => {
    if (ORIGINAL_NODE_ENV === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  });

  it("withholds the code when nothing is configured", () => {
    delete process.env.BOOP_DEV_OTP_ECHO;
    expect(devCodePayload("123456")).toEqual({});
  });

  it("withholds the code even when NODE_ENV is not production", () => {
    delete process.env.BOOP_DEV_OTP_ECHO;
    delete process.env.NODE_ENV;
    expect(devCodePayload("123456")).toEqual({});

    process.env.NODE_ENV = "development";
    expect(devCodePayload("123456")).toEqual({});
  });

  it("requires the literal opt-in value", () => {
    process.env.BOOP_DEV_OTP_ECHO = "1";
    expect(devCodePayload("123456")).toEqual({});

    process.env.BOOP_DEV_OTP_ECHO = "true";
    expect(devCodePayload("123456")).toEqual({ devCode: "123456" });
  });
});

describe("security headers", () => {
  function collectHeaders() {
    const middlewares: Array<(req: unknown, res: unknown, next: () => void) => void> = [];
    const headers = new Map<string, string>();
    const app = {
      disable: () => undefined,
      use: (mw: (req: unknown, res: unknown, next: () => void) => void) => {
        middlewares.push(mw);
      },
    } as unknown as Parameters<typeof applySecurityHeaders>[0];

    applySecurityHeaders(app);

    const res = {
      setHeader: (name: string, value: string | string[]) => {
        headers.set(name.toLowerCase(), Array.isArray(value) ? value.join(", ") : String(value));
      },
      getHeader: (name: string) => headers.get(name.toLowerCase()),
      removeHeader: (name: string) => headers.delete(name.toLowerCase()),
    };
    for (const mw of middlewares) {
      mw({ method: "GET", headers: {} }, res, () => undefined);
    }
    return headers;
  }

  it("sets the headers the public dashboard was missing", () => {
    const headers = collectHeaders();
    expect(headers.get("strict-transport-security")).toContain("max-age=");
    expect(headers.get("x-content-type-options")).toBe("nosniff");
    expect(headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    const csp = headers.get("content-security-policy") ?? "";
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("connect-src 'self'");
  });

  it("keeps the CDN scripts the landing page depends on loadable", () => {
    const csp = collectHeaders().get("content-security-policy") ?? "";
    expect(csp).toContain("https://cdnjs.cloudflare.com");
    expect(csp).toContain("https://cdn.jsdelivr.net");
    // ...but never by opening script-src up wholesale.
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
  });
});

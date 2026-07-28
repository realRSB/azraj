// Browser-enforced only (curl/server-to-server callers ignore CORS entirely),
// so this is defense in depth for the public-auth endpoints: it stops a page
// on another origin from using a signed-in user's browser to call them
// cross-site and read the JSON response. Legitimate use is same-origin only —
// the web app talks to /api/public-auth/* with relative fetch() calls — so
// the allowlist only needs the deployed origin itself plus local dev origins.
//
// Split out of server/index.ts (rather than left inline) so it can be unit
// tested without importing that file, which boots the whole server as an
// import-time side effect.
export function buildCorsOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  const origins = new Set<string>([
    "http://localhost:3456",
    "http://localhost:5173", // debug dashboard (vite)
    "http://localhost:5174", // public web app (vite)
  ]);
  const publicUrl = env.PUBLIC_URL ?? "";
  if (publicUrl && !publicUrl.includes("localhost") && !publicUrl.includes("127.0.0.1")) {
    try {
      origins.add(new URL(publicUrl).origin);
    } catch {
      console.warn(
        `[cors] PUBLIC_URL is not a valid URL, ignoring for origin allowlist: ${publicUrl}`,
      );
    }
  }
  return [...origins];
}

import crypto from "node:crypto";

const MAGIC_LINK_TTL_MS = 1000 * 60 * 10;
const JOIN_CODE_TTL_MS = 1000 * 60 * 10;
const JOIN_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function publicAuthSecret() {
  return (
    process.env.PUBLIC_AUTH_SECRET ??
    process.env.SENDBLUE_API_SECRET ??
    process.env.CONVEX_DEPLOYMENT ??
    "azraj-dev"
  );
}

function publicWebUrl() {
  return (
    process.env.PUBLIC_WEB_URL ??
    process.env.WEB_PUBLIC_URL ??
    process.env.VITE_PUBLIC_WEB_URL ??
    process.env.PUBLIC_URL ??
    "http://localhost:5174"
  ).replace(/\/+$/, "");
}

export function createDashboardMagicToken() {
  return crypto.randomBytes(32).toString("base64url");
}

export function dashboardMagicTokenHash(token: string) {
  return crypto
    .createHash("sha256")
    .update(`${publicAuthSecret()}:dashboard:${token}`)
    .digest("hex");
}

export function joinCodeHash(code: string) {
  return crypto
    .createHash("sha256")
    .update(`${publicAuthSecret()}:join:${normalizeJoinCode(code)}`)
    .digest("hex");
}

export function normalizeJoinCode(code: string) {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
}

export function createJoinCode() {
  let code = "";
  for (let i = 0; i < 7; i += 1) {
    code += JOIN_CODE_ALPHABET[crypto.randomInt(0, JOIN_CODE_ALPHABET.length)];
  }
  return code;
}

export function joinMessage(code: string) {
  return `I'm ready to join Azraj [${normalizeJoinCode(code)}]!`;
}

export function extractJoinCode(content: string) {
  const bracketed = content.match(/\[([A-Za-z0-9]{6,10})\]/);
  return bracketed ? normalizeJoinCode(bracketed[1]) : null;
}

export function dashboardMagicUrl(token: string) {
  const url = new URL("/dashboard", publicWebUrl());
  url.searchParams.set("login", token);
  return url.toString();
}

export function dashboardLinkIntent(content: string, isNewUser: boolean) {
  const normalized = content.toLowerCase().replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  if (
    !isNewUser &&
    /\b(dashboard|login|log in|signin|sign in|link|connect|start connecting)\b/.test(normalized)
  ) {
    return "command";
  }
  return null;
}

export function dashboardMagicMessage(url: string, intent: "command" | "welcome") {
  if (intent === "welcome") {
    return `you're in. dashboard link: ${url}\n\nexpires in 10 min. don't share it.\n\nnow send me today's 3 wins and we'll lock in.`;
  }
  return `gotchu. private dashboard link: ${url}\n\nexpires in 10 min. don't share it.`;
}

export async function issueDashboardMagicLink(phoneE164: string) {
  const [{ api }, { convex }] = await Promise.all([
    import("../convex/_generated/api.js"),
    import("./convex-client.js"),
  ]);
  const token = createDashboardMagicToken();
  const expiresAt = Date.now() + MAGIC_LINK_TTL_MS;
  await convex.mutation(api.publicUsers.issueDashboardMagicLink, {
    phoneE164,
    tokenHash: dashboardMagicTokenHash(token),
    expiresAt,
  });
  return { token, url: dashboardMagicUrl(token), expiresAt };
}

export async function issueJoinCode() {
  const [{ api }, { convex }] = await Promise.all([
    import("../convex/_generated/api.js"),
    import("./convex-client.js"),
  ]);
  const code = createJoinCode();
  const expiresAt = Date.now() + JOIN_CODE_TTL_MS;
  await convex.mutation(api.publicUsers.issueJoinCode, {
    codeHash: joinCodeHash(code),
    expiresAt,
  });
  return { code, message: joinMessage(code), expiresAt };
}

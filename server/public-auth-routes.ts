import crypto from "node:crypto";
import express from "express";
import { api } from "../convex/_generated/api.js";
import { convex } from "./convex-client.js";
import { normalizeE164, sendImessage } from "./sendblue.js";
import { redactContactHandle } from "./privacy.js";

const OTP_TTL_MS = 1000 * 60 * 10;

function codeHash(phoneE164: string, code: string) {
  const secret =
    process.env.PUBLIC_AUTH_SECRET ??
    process.env.SENDBLUE_API_SECRET ??
    process.env.CONVEX_DEPLOYMENT ??
    "azraj-dev";
  return crypto
    .createHash("sha256")
    .update(`${secret}:${phoneE164}:${code}`)
    .digest("hex");
}

function createCode() {
  return String(crypto.randomInt(100000, 1000000));
}

function createSessionToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function normalizeCode(value: unknown) {
  return typeof value === "string" ? value.replace(/\D/g, "").slice(0, 6) : "";
}

function devCodePayload(code: string) {
  return process.env.NODE_ENV === "production" ? {} : { devCode: code };
}

export function createPublicAuthRouter(): express.Router {
  const router = express.Router();

  router.post("/start", async (req, res) => {
    const phoneE164 = normalizeE164(String(req.body?.phone ?? ""));
    if (!phoneE164 || !/^\+\d{10,15}$/.test(phoneE164)) {
      res.status(400).json({ error: "enter a valid phone number" });
      return;
    }

    const code = createCode();
    await convex.mutation(api.publicUsers.issuePhoneOtp, {
      phoneE164,
      codeHash: codeHash(phoneE164, code),
      expiresAt: Date.now() + OTP_TTL_MS,
    });

    const text = `azraj login code: ${code}. expires in 10 minutes.`;
    await sendImessage(phoneE164, text);
    console.log(`[public-auth] login code sent to ${redactContactHandle(phoneE164)}`);
    res.json({ ok: true, phoneE164, ...devCodePayload(code) });
  });

  router.post("/verify", async (req, res) => {
    const phoneE164 = normalizeE164(String(req.body?.phone ?? ""));
    const code = normalizeCode(req.body?.code);
    if (!phoneE164 || !/^\+\d{10,15}$/.test(phoneE164) || code.length !== 6) {
      res.status(400).json({ error: "phone and 6-digit code required" });
      return;
    }

    const sessionToken = createSessionToken();
    const result = await convex.mutation(api.publicUsers.verifyPhoneOtp, {
      phoneE164,
      codeHash: codeHash(phoneE164, code),
      sessionToken,
    });
    if (!result.ok) {
      res.status(401).json({ error: result.reason });
      return;
    }
    res.json(result);
  });

  return router;
}

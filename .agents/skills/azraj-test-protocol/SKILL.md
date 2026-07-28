---
name: azraj-test-protocol
description: Testing protocol for Azraj local development vs production. Use whenever the user asks to test, debug, run, verify, smoke test, reproduce, or diagnose Azraj features involving localhost, Railway/prod, azraj.tech, Sendblue/iMessage, ngrok, Convex, Composio integrations, dashboard auth, automations, memory, costs, streaks, or agent behavior.
---

# Azraj Test Protocol

## Core Rule

Test through exactly one environment at a time. Never mix a local dashboard with a production webhook, or a production dashboard with a local webhook.

- Local test path: local dashboard + local server + local Convex + current ngrok + Sendblue webhook pointed to current ngrok.
- Production test path: azraj.tech/Railway + production Convex + Sendblue webhook pointed to Railway/custom prod URL.

If the user reports contradictory behavior such as "first says no then yes", duplicate iMessages, stale data, missing integrations, or dashboard data mismatch, first verify the environment path before changing app logic.

## Decision Tree

1. If the user says localhost, local, dev, npm run dev, Vite, ngrok, or asks to test before deploying, use the local checklist.
2. If the user says live, prod, Railway, azraj.tech, custom domain, deployed, or anyone can use it, use the production checklist.
3. If the user is unsure, identify the active path by checking:
   - server health and process on port 3456,
   - Sendblue receive webhook target,
   - dashboard URL they are using,
   - Convex deployment in env,
   - whether the phone number used to log into dashboard matches the phone texting Azraj.
4. If paths are mixed, stop and fix routing before debugging product behavior.

## Local Checklist

Use this checklist for localhost testing:

```bash
cd /Users/bedir/Developer/personal/azraj
npm run dev
npm run sendblue:webhook:check
curl -sS http://localhost:3456/health
curl -sS http://localhost:3456/runtime-config
```

Expected:

- Server health returns ok.
- Sendblue check says the active ngrok tunnel is registered.
- Dashboard is opened from localhost, usually `http://localhost:5174/dashboard` for the public web app or `http://localhost:5173` for the debug dashboard.
- `.env.local` points at the dev Convex deployment.
- `SENDBLUE_AUTO_WEBHOOK=true` if the user wants automatic local webhook sync.

For iMessage tests, Sendblue must point to the current ngrok URL. If it does not, run the webhook registration command suggested by the check script or restart `npm run dev` with auto-sync enabled.

### Local Sendblue Isolation

Local iMessage testing should use a dedicated dev Sendblue account/key/line, separate from Railway production.

Before changing app logic, verify `.env.local`:

```bash
cd /Users/bedir/Developer/personal/azraj
rg -n "SENDBLUE_|PUBLIC_URL|PUBLIC_WEB_URL|BOOP_ALLOW_OUTBOUND_SMS" .env.local
```

Expected local values:

- `SENDBLUE_API_KEY` and `SENDBLUE_API_SECRET` are the dev Sendblue account credentials, not the production/Railway credentials.
- `SENDBLUE_FROM_NUMBER` is the Sendblue-provisioned dev line people text TO, not Rajveer's personal phone or the phone being used to test.
- `PUBLIC_URL=http://localhost:3456` unless intentionally using a static local tunnel.
- `PUBLIC_WEB_URL=http://localhost:5174` for the public web app.
- `SENDBLUE_AUTO_WEBHOOK=true` for automatic ngrok registration.
- `BOOP_ALLOW_OUTBOUND_SMS=true` only when the user explicitly wants local OTP/outbound sends to real phones.

If the user gives new Sendblue credentials or changes any Sendblue env var:

1. Update only local `.env.local`; do not touch Railway/prod env.
2. Restart `npm run dev`; a running server does not pick up changed env secrets.
3. Let `npm run dev` auto-register the new ngrok URL, or run:

```bash
npm run sendblue:webhook -- <current-ngrok-url>/sendblue/webhook
```

4. Confirm:

```bash
npm run sendblue:webhook:check
```

If outbound sends fail with `Cannot send messages to self`, `missing required parameter: from_number`, or `This phone number is not defined`, suspect `SENDBLUE_FROM_NUMBER` first. Ask for or obtain the actual dev Sendblue line using `sendblue lines`, then update `.env.local` and restart.

### Public Auth Locally

Test signup and sign-in as two different flows:

- Start Connecting / signup is inbound-first:
  - Open `http://localhost:5174`.
  - Click Start Connecting or Sign up.
  - Send the exact bracketed iMessage join code shown in the card.
  - Sendblue must point to the current ngrok URL.
  - If the dashboard link Azraj sends uses `localhost`, open it on the Mac running the dev server, not on the phone.
- Sign in is outbound OTP:
  - The server sends a one-time code to the phone number entered in the sign-in card.
  - Local outbound texting is blocked unless `.env.local` has `BOOP_ALLOW_OUTBOUND_SMS=true`.
  - Restart `npm run dev` after changing `BOOP_ALLOW_OUTBOUND_SMS`.
  - Without that opt-in, `/public-auth/start` returns `otp_delivery_failed` before the request reaches Sendblue.

## Production Checklist

Use this checklist for live testing:

- Dashboard URL is `https://azraj.tech/dashboard`.
- Server is Railway, not the local Mac.
- Sendblue receive webhook points to the Railway/custom production URL, for example:
  `https://azraj-production.up.railway.app/sendblue/webhook` or the production domain route.
- Railway env vars include production Convex, Sendblue, Composio, model/runtime, and auth secrets.
- The integration/dashboard login phone number is the same phone number texting Azraj.
- Do not register ngrok as the Sendblue webhook during production testing.

## Debug Priorities

When a test fails, check in this order:

1. Environment split: dashboard URL and Sendblue webhook target must belong to the same environment.
2. Phone scope: dashboard login phone must match the texting phone.
3. Convex scope: local uses dev Convex; prod uses production Convex.
4. Composio scope: connected accounts are phone-scoped; local/prod may not share them if secrets or Convex differ.
5. Duplicate delivery: Sendblue may retry webhooks; inspect dedupe before blaming the agent.
6. Running code: local TypeScript changes require the dev server process to reload or restart.

## References

Read `references/checklists.md` when you need exact commands, expected outputs, or failure patterns.

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

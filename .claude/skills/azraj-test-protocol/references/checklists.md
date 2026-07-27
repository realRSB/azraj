# Azraj Testing Checklists

## Local Development

Local is for feature work and quick iMessage/dashboard smoke tests.

Commands:

```bash
cd /Users/bedir/Developer/personal/azraj
npm run dev
npm run web:dev
npm run sendblue:webhook:check
```

Useful URLs:

- Public web app: `http://localhost:5174/`
- Public web dashboard: `http://localhost:5174/dashboard`
- Debug dashboard: `http://localhost:5173/`
- Server dashboard route: `http://localhost:3456/dashboard`
- Server health: `http://localhost:3456/health`

Local invariants:

- Sendblue receive webhook must be the current ngrok URL ending in `/sendblue/webhook`.
- `npm run sendblue:webhook:check` must report `status: registered`.
- Use the local dashboard to connect Composio integrations.
- The same personal phone number must be used for dashboard OTP and texting.
- `.env.local` should use the dev Convex deployment.
- Restart `npm run dev` after server code changes, env changes, or webhook/dedupe changes.

Common local failures:

- "Dashboard says connected but iMessage says none": Sendblue is pointing to prod or stale ngrok, or phone scopes differ.
- "First answer says no, second says yes": duplicate webhook delivery, old server process, or model ack path still running stale code.
- "Messages/costs missing": dashboard is reading a different Convex deployment or phone conversation than the server handling texts.
- "Webhook mismatch": ngrok URL changed; register the current tunnel or restart dev with `SENDBLUE_AUTO_WEBHOOK=true`.

## Production

Production is for public/live behavior.

Production invariants:

- Use `https://azraj.tech` and `https://azraj.tech/dashboard`.
- Sendblue receive webhook must point to the Railway/custom production API URL, not ngrok.
- Railway must have production env vars.
- Production Convex is separate from local dev Convex unless deliberately configured otherwise.
- Integrations must be connected from the production dashboard to be visible to the production iMessage agent.

Common production failures:

- "Works locally but not live": production env var missing, production Convex lacks data, or Sendblue points to ngrok.
- "Live dashboard empty": user is signed in with a different phone or production Convex has no historical local messages.
- "Integration connected locally but not live": connect it again on the live dashboard, or intentionally share the Composio user-id secret across environments.

## Smoke Tests

Run these against one environment only:

- iMessage: `what integrations do i have connected?`
- Calendar: `check my Google Calendar and help me plan`
- Dashboard: verify messages, memory, costs, automations, accountability, and connections all update after texting.
- Timezone: set timezone in Settings, then ask `what time zone are you using?`
- Automation: ask `check in with me this afternoon`, then verify automation appears in dashboard with the expected timezone.

## Reporting Back

When explaining a test result, include:

- Which environment was tested: local or production.
- Dashboard URL used.
- Sendblue webhook target.
- Convex deployment type if known.
- Whether the texting phone matched dashboard login.
- Commands run and high-signal outputs.

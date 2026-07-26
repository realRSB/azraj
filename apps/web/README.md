# Azraj Web Dashboard

Azraj has two different dashboard surfaces. Keep them separate:

- **Local debug dashboard**: `http://localhost:5173`
  - operator/debug view for development
  - uses your local server and local Convex dev environment
- **Railway public dashboard**: `https://azraj.tech/dashboard`
  - consumer-facing phone login
  - uses the Railway server and production Convex environment

Do not use local dev to take over the production Sendblue webhook unless you
intentionally want real texts to hit your laptop.

## Start Local Debug

From the repo root:

```bash
cd /Users/bedir/Developer/personal/azraj
npm run dev
```

Open the local debug dashboard:

```txt
http://localhost:5173
```

## Start Local Public Web Preview

Use this only to test the consumer-facing website against your local server:

```bash
cd /Users/bedir/Developer/personal/azraj
npm run dev
npm run web:dev
```

Open the local public web preview:

```txt
http://localhost:5174
```

The Vite preview proxies `/api/*` to your local server on `PORT` (default
`3456`). It is not the Railway dashboard.

## Keep Railway As The Real SMS Agent

When Railway is live, local `.env.local` should include:

```txt
SENDBLUE_AUTO_WEBHOOK=false
```

Then local dev will not register an ngrok receive webhook and steal real
iMessages from production.

To verify Sendblue still points at Railway:

```bash
npm run sendblue:webhook:check -- https://azraj.tech/sendblue/webhook
```

If you intentionally want local to receive real SMS for a short test, set
`SENDBLUE_AUTO_WEBHOOK=true`, run `npm run dev`, and switch it back to `false`
afterward.

## Quick Checklist

```txt
local debug:
1. SENDBLUE_AUTO_WEBHOOK=false
2. npm run dev
3. open http://localhost:5173

local public web preview:
1. npm run dev
2. npm run web:dev
3. open http://localhost:5174

production:
1. open https://azraj.tech/dashboard
2. verify Sendblue points to https://azraj.tech/sendblue/webhook
```

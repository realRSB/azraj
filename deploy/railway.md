# Railway Deployment

This repo is configured for a single Railway service that serves both:

- the public Azraj website/dashboard from `dist/web`
- the Express API/webhook server from `server/index.ts`

Railway reads `railway.json`:

```txt
build: npm run build
start: npm start
healthcheck: /health
```

`convex/_generated` is committed/included in deploys because the web app and
server import those generated Convex client bindings at build time.

## Before Deploying

The service needs these variables in Railway.

Required:

```bash
NODE_ENV=production
BOOP_SERVE_WEB=true
PUBLIC_URL=https://your-railway-domain.up.railway.app

CONVEX_DEPLOYMENT=prod:your-deployment
VITE_CONVEX_URL=https://your-prod-deployment.convex.cloud
CONVEX_URL=https://your-prod-deployment.convex.cloud

SENDBLUE_API_KEY=...
SENDBLUE_API_SECRET=...
SENDBLUE_FROM_NUMBER=+17862139361
VITE_AZRAJ_PHONE_NUMBER=+17862139361
PUBLIC_AUTH_SECRET=...

COMPOSIO_API_KEY=...
COMPOSIO_USER_ID=azraj-production
```

Runtime:

```bash
BOOP_RUNTIME=claude
BOOP_MODEL=claude-sonnet-4-6
ANTHROPIC_API_KEY=...
```

For production, prefer `BOOP_RUNTIME=claude` with `ANTHROPIC_API_KEY` configured
on the Railway service. The local Codex runtime depends on a local `codex login`
session, which is not a good fit for Railway unless you intentionally copy and
maintain auth files on the server.

Generate the OTP secret:

```bash
openssl rand -base64 32
```

## Create / Link Railway Project

From the repo root:

```bash
railway init --name azraj
railway status --json
```

If you already created a project in Railway:

```bash
railway link --project <project-id-or-name>
railway status --json
```

## Set Variables

Set non-secret values:

```bash
railway variable set NODE_ENV=production
railway variable set BOOP_SERVE_WEB=true
railway variable set BOOP_RUNTIME=claude
railway variable set BOOP_MODEL=claude-sonnet-4-6
railway variable set COMPOSIO_USER_ID=azraj-production
```

Set secrets with stdin so they do not land in shell history:

```bash
printf "%s" "$ANTHROPIC_API_KEY" | railway variable set ANTHROPIC_API_KEY --stdin
printf "%s" "$SENDBLUE_API_KEY" | railway variable set SENDBLUE_API_KEY --stdin
printf "%s" "$SENDBLUE_API_SECRET" | railway variable set SENDBLUE_API_SECRET --stdin
printf "%s" "$COMPOSIO_API_KEY" | railway variable set COMPOSIO_API_KEY --stdin
printf "%s" "$PUBLIC_AUTH_SECRET" | railway variable set PUBLIC_AUTH_SECRET --stdin
```

## Deploy

```bash
railway up --detach -m "Deploy persistent Azraj service"
railway deployment list --json
```

Do not treat `railway up --detach` as success by itself. It only queues the
build. Poll deployments until the newest one is `SUCCESS`.

## Public Domain

Use Railway's generated domain first. After it works, add a custom domain in
Railway and update:

```bash
railway variable set PUBLIC_URL=https://azraj.app
```

Then redeploy or restart the service.

## Sendblue Webhook

Once Railway gives you the public URL:

```bash
npm run sendblue:webhook -- https://your-railway-domain.up.railway.app/sendblue/webhook
npm run sendblue:webhook:check -- https://your-railway-domain.up.railway.app/sendblue/webhook
```

After a custom domain:

```bash
npm run sendblue:webhook -- https://azraj.app/sendblue/webhook
npm run sendblue:webhook:check -- https://azraj.app/sendblue/webhook
```

## Smoke Test

```bash
curl https://your-domain/health
curl -I https://your-domain/
curl -I https://your-domain/dashboard
```

Then:

1. Open the public site.
2. Verify a phone number.
3. Text the Sendblue number.
4. Open `/dashboard` and confirm messages, memory, usage, and streak data show.

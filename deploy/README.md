# Azraj Persistent Deployment

This is the V1 path for making Azraj always available from one public domain.

The simplest shape is:

```txt
https://azraj.app/                 -> public website/dashboard
https://azraj.app/api/public-auth  -> phone login
https://azraj.app/sendblue/webhook -> Sendblue inbound iMessage webhook
```

The Node server serves both the API/webhooks and the built web app from
`dist/web`, while Convex stores messages, memories, usage, automations, streaks,
and public dashboard sessions.

## Recommended: Railway

Since Azraj is moving to Railway, use [deploy/railway.md](railway.md).
Railway replaces the VM, Caddy, and process-manager setup below:

```txt
Railway service
  build: npm run build
  start: npm start
  serves: website + API + Sendblue webhook

Convex production
  stores app data

Sendblue
  calls https://<railway-domain>/sendblue/webhook
```

The VM instructions later in this file are kept as a backup path.

## Local production smoke test

Run this before deploying to a VM:

```bash
npm ci
npm run build
BOOP_SERVE_WEB=true npm start
```

Then open:

```txt
http://localhost:3456/
http://localhost:3456/dashboard
```

The public website uses `/api/public-auth/*`; in production the Express server
mounts that alias directly. The sensitive debug/admin routes stay local-only.

## Convex

Deploy schema and functions to the production Convex deployment:

```bash
npm run deploy:convex
```

Set the production Convex URL on the VM:

```bash
VITE_CONVEX_URL=https://your-prod-deployment.convex.cloud
CONVEX_URL=https://your-prod-deployment.convex.cloud
```

Use both values on the server. `VITE_CONVEX_URL` is also baked into the web build.

## VM Setup

Use Ubuntu 24.04 LTS on Azure, DigitalOcean, or another provider.

Install basics:

```bash
sudo apt update
sudo apt install -y git curl
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2
```

Clone and build:

```bash
sudo mkdir -p /opt/azraj
sudo chown "$USER":"$USER" /opt/azraj
git clone git@github.com:realRSB/azraj.git /opt/azraj
cd /opt/azraj
npm ci
npm run build
```

Create `/opt/azraj/.env.local` from `.env.example`, then fill the production
values below.

```bash
NODE_ENV=production
PORT=3456
PUBLIC_URL=https://azraj.app
BOOP_SERVE_WEB=true

CONVEX_DEPLOYMENT=prod:your-deployment
VITE_CONVEX_URL=https://your-prod-deployment.convex.cloud
CONVEX_URL=https://your-prod-deployment.convex.cloud

SENDBLUE_API_KEY=...
SENDBLUE_API_SECRET=...
SENDBLUE_FROM_NUMBER=+17862139361
VITE_AZRAJ_PHONE_NUMBER=+17862139361
PUBLIC_AUTH_SECRET=...

BOOP_RUNTIME=claude
BOOP_MODEL=claude-sonnet-4-6
ANTHROPIC_API_KEY=...

COMPOSIO_API_KEY=...
COMPOSIO_USER_ID=azraj-production
```

Generate `PUBLIC_AUTH_SECRET` with:

```bash
openssl rand -base64 32
```

Start with pm2:

```bash
cd /opt/azraj
pm2 start "npm start" --name azraj
pm2 save
pm2 startup
```

`pm2 startup` prints one command. Run that command with `sudo`.

## HTTPS

Install Caddy:

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install -y caddy
```

Copy `deploy/caddy/Caddyfile.example` to `/etc/caddy/Caddyfile`, edit the
domain, then reload:

```bash
sudo caddy fmt --overwrite /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Make sure DNS points `azraj.app` to the VM public IP before reloading Caddy.

## Sendblue

Register the production webhook:

```bash
npm run sendblue:webhook -- https://azraj.app/sendblue/webhook
npm run sendblue:webhook:check -- https://azraj.app/sendblue/webhook
```

After that, anyone can text the Sendblue number. The website phone login sends
OTP codes through the same Sendblue number and shows that user's Convex-backed
dashboard after verification.

## Production checks

Run:

```bash
curl https://azraj.app/health
curl -I https://azraj.app/
curl -I https://azraj.app/dashboard
npm run sendblue:webhook:check -- https://azraj.app/sendblue/webhook
pm2 logs azraj
```

Then test with a real phone:

1. Open `https://azraj.app`.
2. Start connecting with your phone number.
3. Verify the OTP text.
4. Tap Open iMessage and text Azraj.
5. Open `/dashboard` and confirm messages, memory, usage, and streak data appear.

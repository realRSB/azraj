# Azraj Web Dashboard

Use this when you want to reopen the local Azraj website/dashboard.

## Start Azraj

From the repo root:

```bash
cd /Users/bedir/Developer/personal/azraj
npm run dev
```

In a second terminal:

```bash
cd /Users/bedir/Developer/personal/azraj
npm run web:dev
```

Open:

```txt
http://localhost:5174
```

## Check Sendblue Webhook

After `npm run dev` starts, check whether Sendblue points to the current ngrok URL:

```bash
npm run sendblue:webhook:check
```

If it says the webhook does not match, update it:

```bash
npm run sendblue:webhook
```

## Quick Checklist

```txt
1. npm run dev
2. npm run web:dev
3. open http://localhost:5174
4. run npm run sendblue:webhook:check
5. if mismatched, run npm run sendblue:webhook
```

# Streak card fallback backgrounds

Scenic landscape photos that ship **in** the repo as the always-present
fallback for the streak card.

The card normally fetches a **fresh photo every day** (see
`server/streak/photos.ts` → `fetchDailyBackground`). These committed photos are
the safety net: if that fetch fails (no network, source down) and no local
photos are installed in `assets/streak-backgrounds/`, the card falls back to one
of these — so it is **always a real photo, never vector art**.

## Source & license

Lorem Picsum (https://picsum.photos), which serves photos under the
**Unsplash License** (https://unsplash.com/license) — free for commercial and
non-commercial use, no attribution required. Hand-picked landscape shots
(fjords, peaks, coastlines, canyons) cropped to the card's 1080×1350 frame.

To refresh or expand the daily-fetch pool of installed photos instead, run
`npm run streak:backgrounds` (writes to the gitignored
`assets/streak-backgrounds/`).

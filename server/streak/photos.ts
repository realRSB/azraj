import { existsSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Where real-photo backgrounds live. Populated by
// `npm run streak:backgrounds` (see scripts/fetch-streak-backgrounds.mjs) and
// gitignored, so no third-party image binaries land in the repo. When empty,
// the card uses the daily remote photo, then the committed fallback photos.
const here = dirname(fileURLToPath(import.meta.url));
export const BACKGROUNDS_DIR = resolve(here, "../../assets/streak-backgrounds");

const IMAGE_EXT = /\.(jpe?g|png|webp)$/i;
const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { at: number; files: string[] } | null = null;

function listBackgrounds(): string[] {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.files;
  let files: string[] = [];
  try {
    if (existsSync(BACKGROUNDS_DIR)) {
      files = readdirSync(BACKGROUNDS_DIR)
        .filter((f) => IMAGE_EXT.test(f))
        .sort()
        .map((f) => resolve(BACKGROUNDS_DIR, f));
    }
  } catch {
    files = [];
  }
  cache = { at: Date.now(), files };
  return files;
}

function hash(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h;
}

// Deterministically pick a background photo path for a seed (e.g. the local
// date), so the card rotates day to day but is stable within a day. Returns
// null when no photos are installed — callers then use the vector fallback.
export function pickBackgroundPhoto(seed: string): string | null {
  const files = listBackgrounds();
  if (files.length === 0) return null;
  return files[hash(seed) % files.length];
}

export function hasBackgroundPhotos(): boolean {
  return listBackgrounds().length > 0;
}

// --- Committed real-photo fallback ---------------------------------------
// A small set of scenic landscape photos that ship IN the repo (Unsplash
// License, see the folder's README). Used when the daily remote fetch fails
// and no local photos are installed, so the card is ALWAYS a real photo —
// never vector scenery. Committed set is static, so cache the listing forever.
const FALLBACKS_DIR = resolve(here, "../../assets/streak-fallbacks");
let fallbackCache: string[] | null = null;

function listFallbacks(): string[] {
  if (fallbackCache) return fallbackCache;
  let files: string[] = [];
  try {
    if (existsSync(FALLBACKS_DIR)) {
      files = readdirSync(FALLBACKS_DIR)
        .filter((f) => IMAGE_EXT.test(f))
        .sort()
        .map((f) => resolve(FALLBACKS_DIR, f));
    }
  } catch {
    files = [];
  }
  fallbackCache = files;
  return files;
}

// Deterministically pick one of the committed fallback photos for a seed, so it
// still rotates day to day. Returns null only if the folder is somehow empty.
export function pickFallbackPhoto(seed: string): string | null {
  const files = listFallbacks();
  if (files.length === 0) return null;
  return files[hash(seed) % files.length];
}

// --- Daily-fresh remote background (Windows-Spotlight style) --------------
// Instead of rotating a small fixed set, fetch a NEW photo each day so the card
// never repeats. Two sources, in order:
//   1. Unsplash (curated nature/landscape) when UNSPLASH_ACCESS_KEY is set.
//   2. Lorem Picsum seeded by the day — keyless, a different photo every day,
//      effectively never repeating (Unsplash License, no attribution).
// Result bytes are cached in memory keyed by the day-seed, so we fetch at most
// once per day. Returns null on any failure → caller falls back to local
// photos, then vector scenery.
const REMOTE_W = 1080;
const REMOTE_H = 1350;

const dailyCache = new Map<string, Buffer>();

async function fetchUnsplash(): Promise<Buffer | null> {
  const key = process.env.UNSPLASH_ACCESS_KEY;
  if (!key) return null;
  try {
    const meta = await fetch(
      "https://api.unsplash.com/photos/random?orientation=portrait&content_filter=high&query=landscape,nature,scenery,mountains",
      { headers: { Authorization: `Client-ID ${key}` }, signal: AbortSignal.timeout(8000) },
    );
    if (!meta.ok) return null;
    const data = (await meta.json()) as { urls?: { raw?: string; regular?: string } };
    const base = data.urls?.raw;
    const url = base
      ? `${base}&w=${REMOTE_W}&h=${REMOTE_H}&fit=crop&crop=entropy&q=80&fm=jpg`
      : data.urls?.regular;
    if (!url) return null;
    const img = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!img.ok) return null;
    return Buffer.from(await img.arrayBuffer());
  } catch {
    return null;
  }
}

async function fetchPicsum(seed: string): Promise<Buffer | null> {
  try {
    const res = await fetch(
      `https://picsum.photos/seed/${encodeURIComponent(seed)}/${REMOTE_W}/${REMOTE_H}`,
      { redirect: "follow", signal: AbortSignal.timeout(10_000) },
    );
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

export async function fetchDailyBackground(seed: string): Promise<Buffer | null> {
  const cached = dailyCache.get(seed);
  if (cached) return cached;
  const buf = (await fetchUnsplash()) ?? (await fetchPicsum(seed));
  if (buf && buf.length > 1024) {
    // Keep the cache from growing unbounded across many preview seeds.
    if (dailyCache.size > 8) dailyCache.clear();
    dailyCache.set(seed, buf);
    return buf;
  }
  return null;
}

import { existsSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Where real-photo backgrounds live. Populated by
// `npm run streak:backgrounds` (see scripts/fetch-streak-backgrounds.mjs) and
// gitignored, so no third-party image binaries land in the repo. When empty,
// the card falls back to the built-in vector scenes.
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

#!/usr/bin/env node
// Download the streak-card background photos into assets/streak-backgrounds/.
//
// Source: Lorem Picsum (https://picsum.photos), which serves photos from
// Unsplash under the Unsplash License (https://unsplash.com/license) — free
// for commercial and non-commercial use, no attribution required. We fetch a
// hand-curated set of landscape/nature shots (the "Windows Spotlight" vibe),
// cropped to the card's 1080x1350 portrait frame.
//
// The images themselves are gitignored — run this once after cloning to
// populate the folder. Without them, the card falls back to built-in vector
// scenery, so this step is optional.
//
// Usage:  npm run streak:backgrounds
//         node scripts/fetch-streak-backgrounds.mjs --force   (re-download all)

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, "..", "assets", "streak-backgrounds");
const force = process.argv.includes("--force");

// Curated Picsum photo ids — landscapes only (mountains, fjords, coastlines,
// valleys, deserts). Verified to render well behind the streak number.
const PHOTOS = [
  { id: 1015, name: "fjord-cliffs" },
  { id: 1043, name: "valley-cliffs" },
  { id: 29, name: "snowy-peaks" },
  { id: 1018, name: "green-hills-road" },
  { id: 1039, name: "waterfall-valley" },
  { id: 1050, name: "coastal-cliffs" },
  { id: 1016, name: "red-rock-dusk" },
  { id: 10, name: "forest-coast" },
  { id: 1036, name: "snow-camp" },
  { id: 1057, name: "coastal-ridge" },
];

const WIDTH = 1080;
const HEIGHT = 1350;

if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

let ok = 0;
let skipped = 0;
for (const { id, name } of PHOTOS) {
  const dest = resolve(outDir, `${String(ok + skipped + 1).padStart(2, "0")}-${name}.jpg`);
  if (!force && existsSync(dest)) {
    console.log(`• ${name}: already present`);
    skipped++;
    continue;
  }
  const url = `https://picsum.photos/id/${id}/${WIDTH}/${HEIGHT}`;
  try {
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) {
      console.error(`✗ ${name} (id ${id}): HTTP ${res.status}`);
      continue;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(dest, buf);
    console.log(`✓ ${name}: ${(buf.length / 1024).toFixed(0)} KB`);
    ok++;
  } catch (err) {
    console.error(`✗ ${name} (id ${id}): ${err}`);
  }
}

console.log(
  `\nDone. ${ok} downloaded, ${skipped} already present → ${outDir}` +
    `\nPhotos: Unsplash License via Lorem Picsum (free, no attribution).`,
);

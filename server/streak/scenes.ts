// Layered vector scenery for the streak card. Each scene is composed from
// gradient skies, a sun/moon with glow, and atmospheric mountain/hill ridges
// (lighter + hazier toward the back for depth). No external images — every
// pixel is drawn here, so the card is self-contained and license-clean, and a
// new scene is picked each day so the morning card always feels fresh.

export const WIDTH = 1080;
export const HEIGHT = 1350;

export interface Scene {
  id: string;
  // Average luminance of the region behind the number (0 dark – 1 bright).
  // The card uses this to decide whether the number should be light or dark
  // so it always blends yet stays readable.
  centerLuma: number;
  svg: string;
}

type Pt = [number, number];

// Build a filled ridge: a jagged silhouette from left to right, dropped to the
// bottom of the canvas and closed. Optional blur softens far ranges into haze.
function ridge(points: Pt[], fill: string, opacity = 1, blur?: number): string {
  const d =
    `M0 ${HEIGHT} L0 ${points[0][1].toFixed(1)} ` +
    points.map(([x, y]) => `L${x.toFixed(1)} ${y.toFixed(1)}`).join(" ") +
    ` L${WIDTH} ${HEIGHT} Z`;
  const filter = blur ? ` filter="url(#blur${blur})"` : "";
  return `<path d="${d}" fill="${fill}" opacity="${opacity}"${filter}/>`;
}

// A few authored ridgelines (natural-looking, not random). Reused across
// scenes at different colors/heights.
const RIDGE_BACK: Pt[] = [
  [0, 720], [120, 690], [240, 715], [360, 650], [480, 700],
  [600, 640], [720, 695], [840, 660], [960, 705], [1080, 680],
];
const RIDGE_MID: Pt[] = [
  [0, 830], [130, 760], [260, 820], [390, 720], [520, 800],
  [650, 700], [780, 810], [910, 740], [1080, 815],
];
const RIDGE_FRONT: Pt[] = [
  [0, 980], [160, 890], [320, 970], [470, 860], [620, 950],
  [770, 880], [920, 965], [1080, 900],
];
const DUNE_BACK: Pt[] = [
  [0, 820], [300, 760], [620, 810], [900, 770], [1080, 800],
];
const DUNE_FRONT: Pt[] = [
  [0, 1000], [280, 900], [560, 990], [820, 910], [1080, 980],
];

function stars(count: number, seed: number): string {
  // Deterministic pseudo-random star field so a given scene is stable.
  let s = seed;
  const rnd = () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
  let out = "";
  for (let i = 0; i < count; i++) {
    const x = Math.round(rnd() * WIDTH);
    const y = Math.round(rnd() * 560);
    const r = (rnd() * 1.8 + 0.6).toFixed(1);
    const o = (rnd() * 0.6 + 0.3).toFixed(2);
    out += `<circle cx="${x}" cy="${y}" r="${r}" fill="#ffffff" opacity="${o}"/>`;
  }
  return out;
}

const BLUR_DEFS = `
  <filter id="blur8" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="8"/></filter>
  <filter id="blur20" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="20"/></filter>
  <filter id="sunglow" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="70"/></filter>`;

function sky(stops: Array<[number, string]>): string {
  const s = stops.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join("");
  return `<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">${s}</linearGradient>`;
}

function celestial(cx: number, cy: number, r: number, core: string, glow: string): string {
  return `
    <circle cx="${cx}" cy="${cy}" r="${r * 2.6}" fill="${glow}" opacity="0.55" filter="url(#sunglow)"/>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="${core}"/>`;
}

// ---- Scenes -------------------------------------------------------------

function sunrisePeaks(): Scene {
  return {
    id: "sunrise-peaks",
    centerLuma: 0.35,
    svg: `
      <defs>${BLUR_DEFS}${sky([
        [0, "#241a52"], [0.4, "#6a3d8f"], [0.66, "#ff6a88"], [0.83, "#ff9e6d"], [1, "#ffd8a8"],
      ])}</defs>
      <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#sky)"/>
      ${celestial(806, 792, 120, "#fff2cf", "#ffcaa0")}
      ${ridge(RIDGE_BACK, "#8a5b96", 0.55, 20)}
      ${ridge(RIDGE_MID, "#5a3a7a", 0.85, 8)}
      ${ridge(RIDGE_FRONT, "#2a1c48")}`,
  };
}

function oceanDusk(): Scene {
  return {
    id: "ocean-dusk",
    centerLuma: 0.4,
    svg: `
      <defs>${BLUR_DEFS}${sky([
        [0, "#1a1140"], [0.35, "#5b2a86"], [0.6, "#c43e78"], [0.78, "#ff7e5f"], [0.86, "#ffb56b"], [0.86, "#3a2a6a"], [1, "#0e1a4a"],
      ])}
      <linearGradient id="water" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#ffb56b" stop-opacity="0.5"/>
        <stop offset="0.25" stop-color="#c43e78" stop-opacity="0.35"/>
        <stop offset="1" stop-color="#0e1a4a"/>
      </linearGradient></defs>
      <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#sky)"/>
      ${celestial(280, 690, 118, "#ffe9c2", "#ff9e6d")}
      <rect y="860" width="${WIDTH}" height="${HEIGHT - 860}" fill="url(#water)"/>
      <rect x="238" y="860" width="84" height="360" fill="#ffe9c2" opacity="0.16" filter="url(#blur8)"/>
      ${ridge(RIDGE_MID.map(([x, y]) => [x, y + 20] as Pt), "#241a44", 0.9)}`,
  };
}

function alpineNight(): Scene {
  return {
    id: "alpine-night",
    centerLuma: 0.18,
    svg: `
      <defs>${BLUR_DEFS}${sky([
        [0, "#05060f"], [0.45, "#0d1430"], [0.75, "#1b2450"], [1, "#33406e"],
      ])}</defs>
      <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#sky)"/>
      ${stars(140, 4211)}
      ${celestial(800, 300, 90, "#eef3ff", "#7f8fd0")}
      ${ridge(RIDGE_BACK, "#3a4a80", 0.5, 20)}
      ${ridge(RIDGE_MID, "#243258", 0.9, 8)}
      ${ridge(RIDGE_FRONT, "#0e1430")}`,
  };
}

function goldenValley(): Scene {
  return {
    id: "golden-valley",
    centerLuma: 0.5,
    svg: `
      <defs>${BLUR_DEFS}${sky([
        [0, "#3b6ea5"], [0.4, "#7fb2d8"], [0.7, "#ffd98a"], [1, "#ffb04a"],
      ])}</defs>
      <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#sky)"/>
      ${celestial(806, 700, 120, "#fff6d8", "#ffd98a")}
      ${ridge(RIDGE_BACK.map(([x, y]) => [x, y + 120] as Pt), "#8fb98f", 0.6, 20)}
      ${ridge(RIDGE_MID.map(([x, y]) => [x, y + 120] as Pt), "#4f8f6a", 0.9, 8)}
      ${ridge(RIDGE_FRONT.map(([x, y]) => [x, y + 100] as Pt), "#245c46")}`,
  };
}

function desertDunes(): Scene {
  return {
    id: "desert-dunes",
    centerLuma: 0.45,
    svg: `
      <defs>${BLUR_DEFS}${sky([
        [0, "#3a2a6a"], [0.4, "#b5568a"], [0.7, "#ff8a5c"], [1, "#ffd39e"],
      ])}</defs>
      <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#sky)"/>
      ${celestial(838, 430, 104, "#fff0d0", "#ff9e6d")}
      ${ridge(DUNE_BACK, "#e08a5a", 0.75, 8)}
      ${ridge(DUNE_FRONT, "#a85536")}`,
  };
}

const SCENES: Array<() => Scene> = [
  sunrisePeaks,
  oceanDusk,
  alpineNight,
  goldenValley,
  desertDunes,
];

// Pick a scene deterministically from a seed string (e.g. the local date), so
// the card rotates day to day but is stable within a day / across retries.
export function pickScene(seed: string): Scene {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return SCENES[h % SCENES.length]();
}

export function sceneById(id: string): Scene | null {
  const found = SCENES.map((f) => f()).find((s) => s.id === id);
  return found ?? null;
}

export const SCENE_IDS = SCENES.map((f) => f().id);

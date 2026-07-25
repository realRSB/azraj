import sharp from "sharp";
import { HEIGHT, WIDTH, pickScene, sceneById, type Scene } from "./scenes.js";
import { pickBackgroundPhoto } from "./photos.js";

export type StreakCardState = "alive" | "today" | "broken";

export interface StreakCardInput {
  // The number to feature. For "broken" this is the longest run (shown as
  // "best" motivation) rather than the current (which is 0).
  streak: number;
  longest: number;
  state: StreakCardState;
  // Human date line, e.g. "Thursday · July 23".
  dateLabel: string;
  // Seed that selects the daily background (photo or vector scene). Defaults
  // to the date label so previews still rotate.
  seed?: string;
  // Force a specific vector scene id (previews/tests only).
  scene?: string;
  // Set false to ignore installed photos and always use the vector scenes.
  usePhotos?: boolean;
  // True when today's text restarted the streak after a 2+ day gap. Shifts the
  // copy to a comeback tone instead of a plain "day one".
  reset?: boolean;
  // Output encoding. JPEG (default for sends) keeps the photo card well under
  // MMS size limits; PNG stays crisp for on-screen previews.
  format?: "png" | "jpeg";
}

// Font stack: Segoe UI on the maintainer's Windows box, Helvetica/Arial
// everywhere else. All are clean geometric sans faces so the card looks the
// same shape whichever is installed.
const FONT = "'Segoe UI', 'Helvetica Neue', Arial, sans-serif";

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Milestone-aware hype line in Azraj's lowercase coach voice.
function subline(input: StreakCardInput): string {
  const { state, streak, longest } = input;
  if (state === "broken") {
    return longest > 1
      ? `your best was ${longest} days — text me, let's rebuild it.`
      : `every streak starts with day one. text me today.`;
  }
  // Comeback after a gap: they're back to day 1, but acknowledge the history.
  if (input.reset) {
    return longest > 1
      ? `back at it — your best was ${longest}. let's beat it.`
      : `back at it — day one. let's build.`;
  }
  const alreadyIn = state === "today";
  if (streak >= 100) return "triple digits. you're built different.";
  if (streak >= 50) return "50+ days. absolutely locked in.";
  if (streak >= 30) return "a full month of showing up. respect.";
  if (streak >= 14) return "two weeks strong. this is who you are now.";
  if (streak >= 7) return "a full week. the habit is forming.";
  if (streak >= 3) return alreadyIn ? "momentum is real. keep stacking." : "don't break the chain.";
  return alreadyIn ? "day one down. see you tomorrow." : "text me today to keep it alive.";
}

function label(state: StreakCardState): string {
  return state === "broken" ? "STREAK RESET" : "DAY STREAK";
}

function sceneToSvg(scene: Scene): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">${scene.svg}</svg>`;
}

// The transparent foreground: legibility scrims + the glowing number + text.
// Composited over either a real photo or a rasterized vector scene. The
// treatment is tuned to stay readable over busy photos — a soft dark halo and
// drop shadow give the number edge contrast while an outer white glow lets it
// bleed into the scenery, and a bottom gradient carries the caption.
export function buildOverlaySvg(input: StreakCardInput): string {
  const shown = input.state === "broken" ? 0 : input.streak;
  const numberStr = String(shown);
  const numberSize = numberStr.length >= 3 ? 440 : numberStr.length === 2 ? 520 : 560;

  const cx = WIDTH / 2;
  const numY = 620;
  const sub = escapeXml(subline(input));
  const lbl = label(input.state);
  const date = escapeXml(input.dateLabel);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs>
    <radialGradient id="halo" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#05060f" stop-opacity="0.45"/>
      <stop offset="0.55" stop-color="#05060f" stop-opacity="0.22"/>
      <stop offset="1" stop-color="#05060f" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#05060f" stop-opacity="0"/>
      <stop offset="1" stop-color="#05060f" stop-opacity="0.9"/>
    </linearGradient>
    <linearGradient id="topscrim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#05060f" stop-opacity="0.35"/>
      <stop offset="1" stop-color="#05060f" stop-opacity="0"/>
    </linearGradient>
    <filter id="numGlow" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="24"/>
    </filter>
    <filter id="numShadow" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="6" stdDeviation="14" flood-color="#000000" flood-opacity="0.55"/>
    </filter>
  </defs>

  <!-- Legibility scrims -->
  <rect x="0" y="0" width="${WIDTH}" height="300" fill="url(#topscrim)"/>
  <ellipse cx="${cx}" cy="${numY}" rx="470" ry="400" fill="url(#halo)"/>
  <rect x="0" y="840" width="${WIDTH}" height="${HEIGHT - 840}" fill="url(#scrim)"/>

  <!-- Number: outer white glow, then a drop-shadowed crisp glassy number -->
  <text x="${cx}" y="${numY}" font-family="${FONT}" font-size="${numberSize}" font-weight="800"
        fill="#ffffff" text-anchor="middle" dominant-baseline="middle"
        filter="url(#numGlow)" opacity="0.5">${numberStr}</text>
  <text x="${cx}" y="${numY}" font-family="${FONT}" font-size="${numberSize}" font-weight="800"
        fill="#ffffff" fill-opacity="0.97" text-anchor="middle" dominant-baseline="middle"
        filter="url(#numShadow)">${numberStr}</text>

  <!-- Label -->
  <text x="${cx}" y="1070" font-family="${FONT}" font-size="76" font-weight="700"
        letter-spacing="16" fill="#ffffff" text-anchor="middle">${lbl}</text>

  <!-- Subline -->
  <text x="${cx}" y="1145" font-family="${FONT}" font-size="38" font-weight="500"
        fill="#ffffff" fill-opacity="0.85" text-anchor="middle">${sub}</text>

  <!-- Date -->
  <text x="${cx}" y="1285" font-family="${FONT}" font-size="30" font-weight="500"
        letter-spacing="5" fill="#ffffff" fill-opacity="0.62" text-anchor="middle">${date}</text>
</svg>`;
}

// Build the base layer: a real photo cover-cropped to the card, or a vector
// scene when no photos are installed / photos are disabled.
async function loadBase(input: StreakCardInput): Promise<sharp.Sharp> {
  const seed = input.seed ?? input.dateLabel;
  const photo = input.usePhotos === false ? null : pickBackgroundPhoto(seed);
  if (photo) {
    return sharp(photo).resize(WIDTH, HEIGHT, { fit: "cover", position: "centre" });
  }
  const scene: Scene = input.scene
    ? sceneById(input.scene) ?? pickScene(seed)
    : pickScene(seed);
  return sharp(Buffer.from(sceneToSvg(scene)));
}

export interface RenderedCard {
  buffer: Buffer;
  contentType: string;
}

export async function renderStreakCard(input: StreakCardInput): Promise<RenderedCard> {
  const base = await loadBase(input);
  const overlay = Buffer.from(buildOverlaySvg(input));
  const composited = base.composite([{ input: overlay, top: 0, left: 0 }]);
  if (input.format === "jpeg") {
    // quality 82 lands a photo card around ~300–450KB — an order of magnitude
    // smaller than PNG, so the Convex upload and the MMS both stay reliable.
    return { buffer: await composited.jpeg({ quality: 82 }).toBuffer(), contentType: "image/jpeg" };
  }
  return { buffer: await composited.png().toBuffer(), contentType: "image/png" };
export async function renderStreakCardPng(input: StreakCardInput): Promise<Buffer> {
  const base = await loadBase(input);
  const overlay = Buffer.from(buildOverlaySvg(input));
  return await base
    .composite([{ input: overlay, top: 0, left: 0 }])
    .png()
    .toBuffer();
}

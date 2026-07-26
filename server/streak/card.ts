import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { fetchDailyBackground, pickBackgroundPhoto, pickFallbackPhoto } from "./photos.js";

const WIDTH = 1080;
const HEIGHT = 1350;

export type StreakCardState = "alive" | "today" | "broken";

export interface StreakCardInput {
  // The number to feature. For "broken" this is 0 (the card nudges a restart).
  streak: number;
  longest: number;
  state: StreakCardState;
  // Human date line, e.g. "Thursday · July 23". Unused by the minimal card but
  // kept so callers/tests don't change; also seeds the daily background.
  dateLabel: string;
  // Seed that selects the daily background. Defaults to the date label.
  seed?: string;
  // Force a specific vector scene id (previews/tests only).
  scene?: string;
  // Set false to skip the remote daily fetch (use local / committed photos
  // only) — handy for deterministic, offline rendering in tests.
  usePhotos?: boolean;
  // True when today's text restarted the streak after a 2+ day gap.
  reset?: boolean;
  // Output encoding. JPEG (default for sends) keeps the photo card well under
  // MMS size limits; PNG stays crisp for on-screen previews.
  format?: "png" | "jpeg";
}

// Text is drawn with sharp's native (Pango) text renderer pointed at an EXPLICIT
// bundled font file — NOT via SVG <text>. librsvg (what sharp uses for SVG)
// ignores embedded @font-face and only finds system fonts via fontconfig, which
// isn't reliable in the Linux/Railway container — that was the "tofu boxes" bug.
// Loading the .ttf directly renders identically on every host.
const FONTS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../assets/fonts");
const FONT_BOLD = resolve(FONTS_DIR, "Inter-Bold.ttf");
const FONT_REGULAR = resolve(FONTS_DIR, "Inter-Regular.ttf");

// Vertical center of the big number.
const NUMBER_CENTER_Y = 600;

interface RenderedText {
  buf: Buffer;
  width: number;
  height: number;
}

// Render a single line to a transparent PNG at an exact pixel height, using a
// specific font file. Rendered large then scaled down so it stays crisp.
async function renderText(
  text: string,
  fontfile: string,
  targetHeight: number,
  color = "#ffffff",
): Promise<RenderedText> {
  const raw = await sharp({
    text: {
      text: `<span foreground="${color}">${text}</span>`,
      font: "Inter 640",
      fontfile,
      rgba: true,
      dpi: 72,
    },
  })
    .png()
    .toBuffer();
  const buf = await sharp(raw).resize({ height: targetHeight }).png().toBuffer();
  const meta = await sharp(buf).metadata();
  return { buf, width: meta.width ?? 0, height: meta.height ?? 0 };
}

// Legibility scrims only — a dark halo behind the number plus top/bottom
// gradients so white text stays readable over any photo. No text here, so no
// font dependency.
function buildScrimsSvg(): string {
  const cx = WIDTH / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs>
    <radialGradient id="halo" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#05060f" stop-opacity="0.5"/>
      <stop offset="0.55" stop-color="#05060f" stop-opacity="0.24"/>
      <stop offset="1" stop-color="#05060f" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#05060f" stop-opacity="0"/>
      <stop offset="1" stop-color="#05060f" stop-opacity="0.75"/>
    </linearGradient>
    <linearGradient id="topscrim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#05060f" stop-opacity="0.35"/>
      <stop offset="1" stop-color="#05060f" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="${WIDTH}" height="320" fill="url(#topscrim)"/>
  <ellipse cx="${cx}" cy="${NUMBER_CENTER_Y}" rx="500" ry="440" fill="url(#halo)"/>
  <rect x="0" y="${HEIGHT - 420}" width="${WIDTH}" height="420" fill="url(#scrim)"/>
</svg>`;
}

// Build the base layer — ALWAYS a real photo, never vector scenery:
//   1. a fresh remote photo for the day (Windows-Spotlight style),
//   2. any locally-installed photo (optional, user-populated),
//   3. a committed scenic photo that ships in the repo (always present).
// A neutral dark panel is the only non-photo path, and only if the committed
// fallback folder is somehow empty.
async function loadBase(input: StreakCardInput): Promise<sharp.Sharp> {
  const seed = input.seed ?? input.dateLabel;
  if (input.usePhotos !== false) {
    const daily = await fetchDailyBackground(seed);
    if (daily) return sharp(daily).resize(WIDTH, HEIGHT, { fit: "cover", position: "centre" });
  }
  const local = pickBackgroundPhoto(seed);
  if (local) return sharp(local).resize(WIDTH, HEIGHT, { fit: "cover", position: "centre" });
  const fallback = pickFallbackPhoto(seed);
  if (fallback) return sharp(fallback).resize(WIDTH, HEIGHT, { fit: "cover", position: "centre" });
  return sharp({
    create: { width: WIDTH, height: HEIGHT, channels: 3, background: { r: 10, g: 12, b: 24 } },
  });
}

// Compose the foreground text layers over the base. Minimal by design: the big
// streak number with a soft glow, and a small "days" beneath it.
async function buildTextLayers(input: StreakCardInput): Promise<sharp.OverlayOptions[]> {
  const shown = input.state === "broken" ? 0 : input.streak;
  const digits = String(shown);
  const numHeight = digits.length >= 3 ? 360 : digits.length === 2 ? 440 : 480;

  const number = await renderText(digits, FONT_BOLD, numHeight);
  const numLeft = Math.round((WIDTH - number.width) / 2);
  const numTop = Math.round(NUMBER_CENTER_Y - number.height / 2);

  const daysWord = shown === 1 ? "day" : "days";
  const days = await renderText(daysWord, FONT_REGULAR, 72, "#ffffff");
  const daysLeft = Math.round((WIDTH - days.width) / 2);
  const daysTop = numTop + number.height + 44;

  // Crisp text, no glow — the dark halo scrim behind carries legibility.
  return [
    { input: number.buf, top: numTop, left: numLeft },
    { input: days.buf, top: daysTop, left: daysLeft },
  ];
}

export interface RenderedCard {
  buffer: Buffer;
  contentType: string;
}

export async function renderStreakCard(input: StreakCardInput): Promise<RenderedCard> {
  const base = await loadBase(input);
  const scrims: sharp.OverlayOptions = { input: Buffer.from(buildScrimsSvg()), top: 0, left: 0 };
  const text = await buildTextLayers(input);
  const composited = base.composite([scrims, ...text]);
  if (input.format === "jpeg") {
    return { buffer: await composited.jpeg({ quality: 82 }).toBuffer(), contentType: "image/jpeg" };
  }
  return { buffer: await composited.png().toBuffer(), contentType: "image/png" };
}

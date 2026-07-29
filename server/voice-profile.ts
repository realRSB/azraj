// Per-user voice learning.
//
// The corpus in `voice-corpus.ts` sets the BASE register — how Azraj talks to a
// generic person under 25. This module handles the other half: how Azraj talks
// to *this* person. Two users text nothing alike. One writes "yooooo bro 😭😭"
// and one writes "Done with module 2." Answering both identically is what makes
// a product feel like a product.
//
// HOW IT LEARNS
// Deterministically, from messages the user has already sent us. We read their
// recent inbound messages out of Convex and measure observable things: length,
// capitalization, punctuation, which emoji they actually use, which slang they
// actually use, whether they text in bursts. No LLM call, no new table, no
// schema migration — the message history IS the store, so the profile sharpens
// on its own every time they text and survives restarts for free.
//
// WHY NOT ASK A MODEL TO DESCRIBE THEIR STYLE
// It would cost a call per turn and hallucinate traits from three messages.
// Counting is cheaper, instant, and can't invent a trait that isn't there.
//
// MIRRORING IS CAPPED ON PURPOSE
// Azraj adapts toward the user; it does not become them. A user who writes in
// full formal sentences gets a slightly calmer Azraj, not a corporate one — the
// floor stays "friend texting you". And we never mirror profanity or a slur back
// at someone just because they used it.

import { api } from "../convex/_generated/api.js";
import { convex } from "./convex-client.js";

// Below this we don't have enough signal to say anything useful, so we say
// nothing rather than guessing from two messages.
const MIN_MESSAGES = 4;
const SAMPLE_SIZE = 40;
// How many recent messages to pull when measuring style. Exported so a caller
// that fetches history for its own reasons can fetch enough for both uses.
export const VOICE_HISTORY_LIMIT = 120;

// Slang we're willing to echo back if the user uses it first. Deliberately a
// closed list: mirroring arbitrary tokens is how you end up repeating a typo or
// something you shouldn't.
const MIRRORABLE_SLANG = [
  "fr", "ngl", "lowkey", "highkey", "deadass", "bet", "bruh", "bro", "gng",
  "istg", "tbh", "idk", "idc", "imo", "rn", "ong", "iykyk", "mid", "valid",
  "tuff", "cooked", "cooking", "locked in", "lock in", "goated", "w", "l",
  "no shot", "say less", "yk", "ig", "smh", "fml", "atp", "twin", "chat",
  // Shortenings — if they text this way, Azraj should too.
  "wsp", "wsg", "wyd", "hbu", "gm", "gn", "fs", "atm", "omw", "lmk", "nvm",
  "prob", "def", "tmrw", "tho", "cuz", "u", "ur", "ppl", "sm", "smth", "bc",
];

interface StyleSignals {
  sampled: number;
  avgWords: number;
  lowercaseRatio: number;
  emojiPerMessage: number;
  topEmoji: string[];
  slangUsed: string[];
  questionRatio: number;
  terminalPunctuationRatio: number;
  elongates: boolean;
  bursts: boolean;
}

// Emoji (plus skin-tone/ZWJ sequences) — good enough to count and rank; we only
// need "which ones does this person reach for", not perfect Unicode grapheme
// segmentation.
const EMOJI_RE =
  /(\p{Extended_Pictographic}(‍\p{Extended_Pictographic})*(\p{Emoji_Modifier}|️)?)/gu;

function analyze(messages: string[]): StyleSignals {
  const texts = messages.map((m) => m.trim()).filter(Boolean);
  const n = texts.length || 1;

  let words = 0;
  let lowercaseOnly = 0;
  let emojiTotal = 0;
  let questions = 0;
  let terminal = 0;
  let elongated = 0;
  const emojiCounts = new Map<string, number>();
  const slangSeen = new Set<string>();

  for (const raw of texts) {
    words += raw.split(/\s+/).filter(Boolean).length;

    // "No capitals anywhere" only counts when there were letters to capitalize.
    if (/[a-z]/.test(raw) && raw === raw.toLowerCase()) lowercaseOnly++;

    const emoji = raw.match(EMOJI_RE) ?? [];
    emojiTotal += emoji.length;
    for (const e of emoji) emojiCounts.set(e, (emojiCounts.get(e) ?? 0) + 1);

    if (raw.includes("?")) questions++;
    if (/[.!?]$/.test(raw)) terminal++;
    // "yooo", "sooo", "ahhh" — repeated letter three or more times.
    if (/([a-z])\1{2,}/i.test(raw)) elongated++;

    const lower = ` ${raw.toLowerCase().replace(/[^a-z0-9\s]/g, " ")} `;
    for (const s of MIRRORABLE_SLANG) {
      if (lower.includes(` ${s} `)) slangSeen.add(s);
    }
  }

  const topEmoji = [...emojiCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([e]) => e);

  return {
    sampled: texts.length,
    avgWords: words / n,
    lowercaseRatio: lowercaseOnly / n,
    emojiPerMessage: emojiTotal / n,
    topEmoji,
    slangUsed: [...slangSeen].slice(0, 8),
    questionRatio: questions / n,
    terminalPunctuationRatio: terminal / n,
    elongates: elongated / n > 0.15,
    // Short messages on average means they fire off fragments rather than
    // composing a paragraph — so Azraj shouldn't answer a fragment with an essay.
    bursts: words / n < 6,
  };
}

// Turn measurements into instructions. The model is bad at acting on "avgWords:
// 4.2" and good at acting on "they text in fragments — match that".
function describe(s: StyleSignals): string[] {
  const lines: string[] = [];

  if (s.avgWords < 5) {
    lines.push("They text in short fragments. Match it — one line back, not three.");
  } else if (s.avgWords > 25) {
    lines.push(
      "They write long, detailed messages. You can go a little longer than usual, but still don't write paragraphs.",
    );
  }

  if (s.lowercaseRatio > 0.7) {
    lines.push("They type in all lowercase. Stay lowercase, always.");
  } else if (s.lowercaseRatio < 0.2 && s.terminalPunctuationRatio > 0.6) {
    lines.push(
      "They capitalize and punctuate properly. Ease off the lowercase-everything a bit and skip the heaviest slang — still warm and casual, just less chaotic.",
    );
  }

  if (s.emojiPerMessage < 0.1) {
    lines.push("They basically never use emoji. So use almost none — maybe one every several messages.");
  } else if (s.emojiPerMessage > 1) {
    lines.push("They use emoji heavily. You can go up to two when the moment earns it.");
  }

  if (s.topEmoji.length) {
    lines.push(`Emoji they actually use: ${s.topEmoji.join(" ")} — favor these, they're already their vocabulary.`);
  }

  if (s.slangUsed.length) {
    lines.push(`Slang they use themselves: ${s.slangUsed.join(", ")}. These are safe to say back. Words they never use will sound like you're trying.`);
  } else {
    lines.push("They haven't used slang with you yet. Keep yours light until they do.");
  }

  if (s.elongates) {
    lines.push('They stretch words ("yooo", "sooo"). Fine to do back occasionally.');
  }

  if (s.bursts) {
    lines.push("They send quick bursts, not composed messages. Keep the rhythm fast and low-effort.");
  }

  return lines;
}

/**
 * Build the voice-profile block from message rows the caller already has.
 *
 * Split out from `buildVoiceProfile` so a turn that has already fetched recent
 * messages for other reasons doesn't pay for a second round-trip to fetch the
 * same rows again. Pure computation — no I/O, no failure mode.
 */
export function voiceProfileFromMessages(
  rows: Array<{ role?: string; content?: string }>,
): string {
  const userTexts = (rows ?? [])
    .filter((r) => r.role === "user" && typeof r.content === "string")
    .map((r) => r.content as string)
    .slice(0, SAMPLE_SIZE);

  if (userTexts.length < MIN_MESSAGES) {
    return "  (not enough history yet — use the default voice and watch how they text)";
  }

  const signals = analyze(userTexts);
  const notes = describe(signals);
  if (!notes.length) {
    return "  (nothing distinctive yet — default voice is fine)";
  }
  return [
    `  Learned from their last ${signals.sampled} messages:`,
    ...notes.map((l) => `  - ${l}`),
  ].join("\n");
}

/**
 * Build the voice-profile block for a conversation, fetching its messages.
 * Best-effort: any failure degrades to the default voice rather than blocking
 * the turn.
 */
export async function buildVoiceProfile(conversationId: string): Promise<string> {
  try {
    const rows = (await convex.query(api.messages.list, {
      conversationId,
      limit: VOICE_HISTORY_LIMIT,
    })) as Array<{ role?: string; content?: string }>;
    return voiceProfileFromMessages(rows);
  } catch {
    return "  (unavailable this turn — use the default voice)";
  }
}

// Exported for tests.
export const __internal = { analyze, describe };

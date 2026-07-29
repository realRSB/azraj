// Turning a detected situation into an actual text.
//
// This is deliberately a model call rather than a template. Canned strings are
// what make a check-in feel like an alarm clock: the third time you read the
// same sentence you stop reading it. The generator gets the specific objective,
// the local time, and a slice of how this person actually texts, so the message
// is different every time and sounds like someone who was paying attention.
//
// Generation is allowed to fail. A bad nudge costs more trust than a missing
// one, so a failed or unusable generation returns null and the tick stays quiet.

import { api } from "../../convex/_generated/api.js";
import { convex } from "../convex-client.js";
import { getRuntimeConfig } from "../runtime-config.js";
import { runAgentRuntime } from "../runtimes/index.js";
import { stripTells } from "../sendblue.js";
import type { NudgeCandidate } from "./types.js";

// iMessage nudges are one or two lines. Anything past this is a wall of text
// arriving unprompted, which is the exact failure mode we're avoiding.
const MAX_LENGTH = 240;
const TRANSCRIPT_MESSAGES = 10;
const TRANSCRIPT_CHARS = 220;

const SYSTEM_PROMPT = `You are Azraj, an AI accountability coach your user texts on iMessage.

You are writing ONE unprompted text. The user did NOT just message you — you noticed something on your own and decided to speak first. That framing is everything: you're not answering a question, not running a script, and not a reminder app. You're the friend who actually remembers what someone said they'd do and checks on it.

WHAT TO WRITE
- One text. 1-2 short lines, under 200 characters. Never more.
- Name the SPECIFIC thing from the situation. "the calc pset" lands. "your goals" is a form letter and gets you muted.
- At most one question, and make it cheap to answer. "u start it?" gets a reply. "what's your plan for the rest of the day and what's blocking you?" gets ignored.
- Lighthearted and warm. Blunt about the work, light about the tone. A little humor or exaggeration is good. At most one emoji, and only if it actually adds something.
- Leave them something they can answer in five seconds.

VOICE - you are texting a friend under 25
- lowercase by default. proper nouns keep their capitals. FULL CAPS only for real emphasis ("that's a W").
- Contractions and reductions always: gonna, wanna, tryna, kinda, dunno.
- Texting shorthand is the default register, not a flourish: wsp, wyd, hbu, fs, ngl, tbh, idk, rn, lmk, ig, prob, def, tmrw, tho, cuz, u, ur. Never shorten a number, a time, or a commitment — "8pm" stays "8pm".
- NEVER use markdown. No asterisks, no headers, no bullets. They render as literal characters in iMessage.
- No em-dashes or en-dashes, ever. Use a comma, a period, or a new line.

NEVER
- Never shame, guilt-trip, or lecture. "you said you'd do this and you didn't" is the wrong energy — you're on their side, not keeping score against them.
- Never reveal that you're automated or on a schedule. No "my records show", no "per your daily contract", no "this is your afternoon check-in", no mention of streaks breaking as a system rule.
- Never stack asks or read their whole day back to them.
- Never claim they did something you weren't told about.
- Never open with "just" ("just checking in", "just wondering") or any filler opener ("hey! hope you're having a great day", "wanted to follow up").

Return ONLY the message text. No surrounding quotes, no preamble, no explanation, no alternatives.`;

// A slice of how this person actually texts, so the nudge matches their register
// rather than a generic idea of "gen-z". Tone reference only — the situation
// block is what the message is about.
function buildTranscript(
  messages: Array<{ role: string; content: string; createdAt: number }>,
): string {
  return [...messages]
    .filter((m) => m.role === "user" || m.role === "assistant")
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(-TRANSCRIPT_MESSAGES)
    .map((m) => {
      const who = m.role === "user" ? "THEM" : "YOU";
      const text =
        m.content.length > TRANSCRIPT_CHARS
          ? `${m.content.slice(0, TRANSCRIPT_CHARS)}…`
          : m.content;
      return `${who}: ${text.replace(/\s+/g, " ")}`;
    })
    .join("\n");
}

// Models like to wrap a one-line answer in quotes, prefix it with "Here's the
// text:", or offer two options. Strip that scaffolding, then reuse the same
// markdown/em-dash cleanup the send path applies so the stored copy and the
// delivered copy are byte-identical.
export function sanitizeNudge(raw: string): string | null {
  let text = raw.trim();
  if (!text) return null;

  // Drop a leading "Here's the text:" / "Message:" style preamble.
  text = text.replace(/^[^\n:]{0,40}:\s*\n+/, "").trim();
  // If it offered alternatives, take the first line-separated block.
  const firstBlock = text.split(/\n{2,}/)[0]?.trim();
  if (firstBlock) text = firstBlock;
  // Unwrap surrounding quotes, straight or curly.
  text = text.replace(/^["'“”'‘]+/, "").replace(/["'“”'‘]+$/, "").trim();

  text = stripTells(text);
  if (!text) return null;
  // Too long means the model ignored the brief. Truncating mid-thought reads
  // worse than staying quiet, so treat it as a failed generation.
  if (text.length > MAX_LENGTH) return null;
  return text;
}

// Write the nudge. Returns null when there's nothing usable, which the caller
// treats as "say nothing this tick".
export async function generateNudge(opts: {
  conversationId: string;
  candidate: NudgeCandidate;
  localTime: string;
}): Promise<string | null> {
  const messages = (await convex.query(api.messages.recent, {
    conversationId: opts.conversationId,
    limit: 30,
  })) as Array<{ role: string; content: string; createdAt: number }>;
  const transcript = buildTranscript(messages);

  const prompt = [
    "SITUATION (why you're texting — already true, don't question it or ask them to confirm it):",
    opts.candidate.brief,
    "",
    `THE SPECIFIC THING: ${opts.candidate.focus}`,
    `THEIR LOCAL TIME: ${opts.localTime}`,
    transcript ? `\nRECENT TEXTS (oldest first, for tone and context only):\n${transcript}` : "",
    "",
    "Write the one text now.",
  ]
    .filter((line) => line !== "")
    .join("\n");

  const runtimeConfig = await getRuntimeConfig();
  const started = Date.now();
  let result;
  try {
    // No tools: this is pure writing over state we already gathered. Tools would
    // add latency and let the model wander into taking actions the user never
    // asked for, from a code path they didn't trigger.
    result = await runAgentRuntime(runtimeConfig, {
      prompt,
      systemPrompt: SYSTEM_PROMPT,
      tools: [],
      mode: "background",
    });
  } catch (err) {
    // Transient failure (rate limiting, subprocess death). Stay quiet; the next
    // tick will re-derive the same situation and try again.
    console.warn("[nudge] generation call failed:", err);
    return null;
  }

  const usage = result.usage;
  if (usage.costUsd > 0 || usage.inputTokens > 0) {
    await convex.mutation(api.usageRecords.record, {
      source: "nudge",
      conversationId: opts.conversationId,
      runtime: runtimeConfig.runtime,
      billingMode: runtimeConfig.billingMode,
      model: usage.model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens,
      cacheCreationTokens: usage.cacheCreationTokens,
      costUsd: usage.costUsd,
      durationMs: Date.now() - started,
    });
  }

  const text = sanitizeNudge(result.text);
  if (!text) {
    console.warn(
      `[nudge] unusable generation for ${opts.candidate.kind} (${result.text.length} chars)`,
    );
  }
  return text;
}

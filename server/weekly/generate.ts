import { api } from "../../convex/_generated/api.js";
import { convex } from "../convex-client.js";
import { getRuntimeConfig } from "../runtime-config.js";
import { runAgentRuntime } from "../runtimes/index.js";

export interface WeekArticle {
  name: string;
  url?: string | null;
}

export interface WeekContent {
  challenge: string;
  mindset: string;
  person: string;
  why: string;
  article: WeekArticle;
  insights: string[]; // exactly 3
}

const SYSTEM_PROMPT = `You are the analyst behind "Azraj," an accountability coach that texts users. Each week you produce a personalized "Mindset of the Week" and "Person of the Week" for ONE user, based on the SINGLE most salient recurring challenge or problem they keep bringing up in their conversation.

Read the transcript, then produce:
1. challenge: the recurring problem/challenge in one sentence, grounded in what they ACTUALLY said (specific, not generic).
2. mindset: a crisp, memorable principle/frame for the week that directly addresses that challenge — a short phrase, not a paragraph.
3. person: a real, well-known person (living or historical) who visibly embodies overcoming that exact challenge. Genuinely relevant and inspiring; avoid tired clichés if a sharper fit exists.
4. why: ONE sentence connecting this person + mindset to THIS user's challenge, in Azraj's warm, direct, lowercase texting voice.
5. article: recommend ONE real, well-known, reputable article, essay, talk, book, or profile about this person or mindset that genuinely exists. Give its exact title and author/source as "name". Set "url" to null — do NOT invent or guess links; the user will search by name.
6. insights: exactly THREE short, concrete, non-generic "important things to know" about this person/mindset — each a specific lesson, story, or fact the user can act on. These are texted across the week, so make each stand on its own.

Return STRICT JSON ONLY, no markdown, no commentary:
{"challenge":"...","mindset":"...","person":"...","why":"...","article":{"name":"...","url":"..."},"insights":["...","...","..."]}`;

function buildTranscript(
  messages: Array<{ role: string; content: string; createdAt: number }>,
): string {
  return [...messages]
    .filter((m) => m.role === "user" || m.role === "assistant")
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((m) => {
      const who = m.role === "user" ? "USER" : "AZRAJ";
      const text = m.content.length > 600 ? m.content.slice(0, 600) + "…" : m.content;
      return `${who}: ${text}`;
    })
    .join("\n");
}

// Pull the JSON object out of the model's reply, tolerating stray prose or code
// fences, and coerce it into a well-formed WeekContent (or null if unusable).
export function parseWeekContent(raw: string): WeekContent | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
  const challenge = str(obj.challenge);
  const mindset = str(obj.mindset);
  const person = str(obj.person);
  const why = str(obj.why);
  if (!mindset || !person) return null; // the two non-negotiable fields

  const articleRaw = (obj.article ?? {}) as Record<string, unknown>;
  const article: WeekArticle = {
    name: str(articleRaw.name),
    url: typeof articleRaw.url === "string" && /^https?:\/\//i.test(articleRaw.url)
      ? articleRaw.url.trim()
      : null,
  };

  let insights = Array.isArray(obj.insights)
    ? obj.insights.map(str).filter(Boolean)
    : [];
  // Normalize to exactly three so the mid-week scheduler always has a full set.
  insights = insights.slice(0, 3);
  while (insights.length < 3) insights.push(mindset);

  return { challenge, mindset, person, why, article, insights };
}

// Analyze the user's recent chatlog and generate a full week of content. Returns
// null when there isn't enough conversation to work from or the model fails.
export async function generateWeekContent(opts: {
  conversationId: string;
  recentPersons?: string[];
}): Promise<WeekContent | null> {
  const messages = (await convex.query(api.messages.recent, {
    conversationId: opts.conversationId,
    limit: 80,
  })) as Array<{ role: string; content: string; createdAt: number }>;
  const transcript = buildTranscript(messages);
  if (transcript.replace(/\s/g, "").length < 40) return null; // too little to personalize

  const avoid =
    opts.recentPersons && opts.recentPersons.length > 0
      ? `\n\nDo NOT pick any of these recently-used people (choose someone fresh): ${opts.recentPersons.join(", ")}.`
      : "";
  const prompt = `Here is a user's recent conversation with Azraj. Identify the single most salient recurring challenge they keep raising, then produce this week's mindset + person of the week for them.${avoid}\n\nTRANSCRIPT:\n${transcript}`;

  const runtimeConfig = await getRuntimeConfig();
  // Pure analysis over the transcript — no tools. We deliberately do NOT use the
  // SDK's WebSearch tool to verify article URLs: WebSearch is a server-side API
  // tool that isn't available on the Claude Code subscription, so invoking it
  // crashes the subprocess ("exited with code 1"). The model names a real
  // article by title + author instead (url:null), which the user can search.
  let result;
  try {
    result = await runAgentRuntime(runtimeConfig, {
      prompt,
      systemPrompt: SYSTEM_PROMPT,
      tools: [],
      mode: "background",
    });
  } catch (err) {
    // Transient failures (e.g. subscription rate-limiting) shouldn't corrupt
    // state — return null and let the caller retry on the next tick.
    console.warn("[weekly] generation call failed:", err);
    return null;
  }
  return parseWeekContent(result.text);
}

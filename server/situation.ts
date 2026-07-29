import { api } from "../convex/_generated/api.js";
import { convex } from "./convex-client.js";
import { embed, embeddingsAvailable } from "./embeddings.js";
import { describeUserNow } from "./timezone-config.js";
import { localParts } from "./weekly/schedule.js";

// Situational awareness for the dispatcher.
//
// Every turn used to start blind: the model got the last few messages and a
// system prompt telling it to call recall() / get_daily_contract /
// list_automations. That made grounding PROBABILISTIC — when the model skipped
// a call it duplicated check-ins, failed to recognise a task it was already
// tracking, and made claims about the user with nothing behind them.
//
// This module assembles that state up front and injects it into the prompt, so
// the facts Azraj needs to coach well are always in view. Tools still exist for
// digging deeper; this is the floor, not the ceiling.
//
// Every section is best-effort: a failure degrades that line to "(unavailable)"
// and never blocks a reply.

const MAX_MEMORIES = 6;
const MAX_OBJECTIVES = 8;
const MAX_AUTOMATIONS = 10;

function partOfDay(hour: number): string {
  if (hour < 5) return "late night";
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  if (hour < 21) return "evening";
  return "night";
}

// Resolve "now" once: the rendered line for the prompt plus the local ISO date
// that the daily contract is keyed by.
async function resolveNow(): Promise<{ line: string; isoDate: string | null }> {
  try {
    const now = await describeUserNow();
    // `hourMinute` is a localized 12-hour string ("7:37 PM"), so reading its
    // leading number gave 7 for 7pm and labelled every afternoon and evening
    // "morning" — while the system prompt tells the model to use this to judge
    // whether it's too late to start something. localParts is timezone-aware,
    // h23, and unit-tested (test/weekly-schedule.test.ts).
    const part = partOfDay(localParts(new Date(), now.timezone).hour);
    return { line: `${now.now} (${part}, ${now.timezone})`, isoDate: now.isoDate };
  } catch {
    return { line: "(unavailable)", isoDate: null };
  }
}

async function streakLine(conversationId: string): Promise<string | null> {
  try {
    const row = (await convex.query(api.streaks.get, { conversationId })) as {
      currentStreak?: number;
      longestStreak?: number;
    } | null;
    if (!row?.currentStreak) return null;
    const best =
      row.longestStreak && row.longestStreak > row.currentStreak
        ? `, best ${row.longestStreak}`
        : "";
    return `${row.currentStreak}-day texting streak${best}`;
  } catch {
    return null;
  }
}

// Today's contract: what they committed to and how far they've got. This is
// what stops Azraj re-asking "what are you working on?" when it already knows,
// and lets it chase the SPECIFIC thing that is still open.
async function contractBlock(
  conversationId: string,
  localDate: string | null,
): Promise<string> {
  if (!localDate) return "(unavailable)";
  try {
    // No cast. `convex` is a typed ConvexHttpClient, so the query's real shape —
    // `{ plan, objectives }`, the dailyPlans row plus its dailyObjectives —
    // comes from the generated API and breaks the build if that query changes.
    // A hand-written cast here previously claimed a flat shape with `date`,
    // `progressNotes` and `nightReview` fields that have never existed, so the
    // progress and review lines below were silently dead and Azraj could ask
    // for a night review it had already recorded.
    const result = await convex.query(api.accountability.getDailyPlan, {
      conversationId,
      localDate,
    });
    if (!result) return "(no plan set for today — if they share goals, create one)";
    const { plan, objectives } = result;

    const lines: string[] = [];
    if (objectives.length) {
      // The stored status ("pending"/"started"/"done"/"slipped") beats a
      // done/open binary: something they started and dropped, and something
      // they've written off as slipped, are different coaching problems than
      // something they never picked up. Matches get_daily_contract's format.
      for (const o of objectives.slice(0, MAX_OBJECTIVES)) {
        lines.push(`    - [${o.status}] ${o.text}`);
      }
    } else {
      lines.push("    (no objectives listed)");
    }
    // Singular and overwritten by each update_daily_progress call, so this is
    // the latest note rather than a history.
    if (plan.progressNote) lines.push(`    progress so far: ${plan.progressNote}`);
    if (plan.status === "reviewed") {
      lines.push("    night review: already recorded today");
    }
    return `${plan.localDate}\n${lines.join("\n")}`;
  } catch {
    return "(unavailable)";
  }
}

// Active check-ins. Injected so the model can SEE what already exists before it
// creates another one — the direct fix for duplicate reminders about one task.
async function automationsBlock(): Promise<string> {
  try {
    const rows = (await convex.query(api.automations.list, {})) as Array<{
      name?: string;
      schedule?: string;
      task?: string;
      enabled?: boolean;
    }>;
    const active = (rows ?? []).filter((r) => r.enabled !== false);
    if (!active.length) return "    (none active)";
    return active
      .slice(0, MAX_AUTOMATIONS)
      .map((r) => `    - "${r.name ?? "(unnamed)"}" [${r.schedule ?? "?"}]`)
      .join("\n");
  } catch {
    return "(unavailable)";
  }
}

// Pre-load memories relevant to what the user just said. recall() stays
// available for deliberate lookups; this guarantees the obvious ones are
// already in view so Azraj doesn't contradict or re-ask known facts.
async function memoriesBlock(conversationId: string, userText: string): Promise<string> {
  const query = userText.trim();
  if (!query) return "(none)";
  try {
    let records: Array<{ content?: string; segment?: string }> = [];
    if (embeddingsAvailable()) {
      const vec = await embed(query);
      if (vec) {
        const hits = (await convex.action(api.memoryRecords.vectorSearch, {
          embedding: vec,
          conversationId,
          limit: MAX_MEMORIES,
        })) as Array<{ record: { content?: string; segment?: string } }>;
        records = hits.map((h) => h.record);
      }
    }
    if (!records.length) {
      records = (await convex.query(api.memoryRecords.search, {
        query,
        conversationId,
        limit: MAX_MEMORIES,
      })) as Array<{ content?: string; segment?: string }>;
    }
    if (!records.length) return "    (no matching memories — recall() for other angles)";
    return records
      .slice(0, MAX_MEMORIES)
      .map((r) => `    - [${r.segment ?? "context"}] ${r.content ?? ""}`.trimEnd())
      .join("\n");
  } catch {
    return "(unavailable)";
  }
}

// Build the block injected as {{SITUATION}}. Sections are fetched concurrently
// so this adds roughly one round-trip to the turn, not five.
export async function buildSituation(opts: {
  conversationId: string;
  userText: string;
}): Promise<string> {
  // "now" first — the contract is keyed by the user's local date.
  const now = await resolveNow();
  const [streak, contract, automations, memories] = await Promise.all([
    streakLine(opts.conversationId),
    contractBlock(opts.conversationId, now.isoDate),
    automationsBlock(),
    memoriesBlock(opts.conversationId, opts.userText),
  ]);

  return [
    `  Now: ${now.line}`,
    streak ? `  Streak: ${streak}` : null,
    `  Today's contract: ${contract}`,
    `  Active check-ins:\n${automations}`,
    `  Relevant memories:\n${memories}`,
  ]
    .filter(Boolean)
    .join("\n");
}

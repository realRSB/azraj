import { z } from "zod";
import { api } from "../convex/_generated/api.js";
import { convex } from "./convex-client.js";
import { nextRunFor, validateSchedule } from "./automations.js";
import { describeUserNow } from "./timezone-config.js";
import { createClaudeMcpServer } from "./runtimes/claude.js";
import { defineRuntimeTool } from "./runtimes/tool.js";
import { runtimeText, type RuntimeTool } from "./runtimes/types.js";

const NAMESPACE = "boop-accountability";

const objectiveStatus = z.enum(["pending", "started", "done", "slipped"]);

function randomId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeLocalTime(input: string): string | null {
  const trimmed = input.trim().toLowerCase();
  const simple = trimmed.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!simple) return null;
  let hour = Number(simple[1]);
  const minute = simple[2] === undefined ? 0 : Number(simple[2]);
  const meridiem = simple[3];
  if (minute < 0 || minute > 59) return null;
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    if (meridiem === "am") hour = hour === 12 ? 0 : hour;
    if (meridiem === "pm") hour = hour === 12 ? 12 : hour + 12;
  } else if (hour < 0 || hour > 23) {
    return null;
  }
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function cronForLocalTime(input: string): string | null {
  const normalized = normalizeLocalTime(input);
  if (!normalized) return null;
  const [hour, minute] = normalized.split(":");
  return `${Number(minute)} ${Number(hour)} * * *`;
}

export function accountabilityAutomationSpecs(times: {
  midday?: string;
  evening?: string;
  night?: string;
}) {
  return [
    {
      key: "midday",
      name: "azraj midday check-in",
      time: times.midday ?? "13:00",
      task:
        "Send a concise Azraj accountability check-in. Ask if the user started today's daily contract, what proof exists, and what one next move they will do right now. Keep it lowercase, direct, motivating, and iMessage-short.",
    },
    {
      key: "evening",
      name: "azraj evening progress",
      time: times.evening ?? "17:00",
      task:
        "Send a concise Azraj progress check. Ask which daily objectives moved, which one is stuck, and what can still be salvaged before night review. Keep it lowercase, direct, motivating, and iMessage-short.",
    },
    {
      key: "night",
      name: "azraj night review",
      time: times.night ?? "21:00",
      task:
        "Run Azraj's night review. Ask what was completed, what slipped, why it slipped, and tomorrow's one adjustment. Push for honesty without shaming. Keep it lowercase, direct, motivating, and iMessage-short.",
    },
  ];
}

async function ensureAccountabilityAutomations(
  conversationId: string,
  times: { midday?: string; evening?: string; night?: string },
) {
  const tzInfo = await describeUserNow();
  const mine = await convex.query(api.automations.list, {
    enabledOnly: false,
    conversationId,
  });
  const created: Array<{ name: string; schedule: string; nextRunAt?: number }> = [];
  const skipped: string[] = [];
  const invalid: Array<{ name: string; time: string }> = [];

  for (const spec of accountabilityAutomationSpecs(times)) {
    if (mine.some((automation) => automation.name === spec.name)) {
      skipped.push(spec.name);
      continue;
    }
    const schedule = cronForLocalTime(spec.time);
    if (!schedule) {
      invalid.push({ name: spec.name, time: spec.time });
      continue;
    }
    const validation = validateSchedule(schedule, tzInfo.timezone);
    if (!validation.valid) {
      invalid.push({ name: spec.name, time: spec.time });
      continue;
    }
    const nextRunAt = nextRunFor(schedule, tzInfo.timezone) ?? undefined;
    await convex.mutation(api.automations.create, {
      automationId: randomId("acct"),
      name: spec.name,
      task: spec.task,
      integrations: [],
      schedule,
      timezone: tzInfo.timezone,
      conversationId,
      notifyConversationId: conversationId,
      nextRunAt,
    });
    created.push({ name: spec.name, schedule, nextRunAt });
  }

  return {
    timezone: tzInfo.timezone,
    timezoneIsExplicit: tzInfo.isExplicit,
    created,
    skipped,
    invalid,
  };
}

export function createAccountabilityTools(conversationId: string): RuntimeTool[] {
  return [
    defineRuntimeTool(
      NAMESPACE,
      "create_daily_contract",
      "Create or replace today's structured Azraj daily contract. Use this during morning planning or whenever the user gives goals for the day. This also schedules the default recurring accountability check-ins unless disabled.",
      {
        journal: z.string().optional().describe("Short journal-style check-in from the user."),
        energy: z.string().optional().describe("User's energy level or body state."),
        mood: z.string().optional().describe("User's mood or mindset."),
        blockers: z.string().optional().describe("Known blockers, distractions, or risks."),
        definitionOfDone: z
          .string()
          .optional()
          .describe("What would make today count in the user's own words."),
        objectives: z
          .array(z.string())
          .min(1)
          .max(6)
          .describe("Concrete daily objectives with verbs, scope, and finish lines."),
        scheduleCheckIns: z
          .boolean()
          .optional()
          .default(true)
          .describe("Whether Azraj should ensure recurring midday/evening/night check-ins exist."),
        middayCheckInTime: z.string().optional().describe("Local time like 13:00 or 1pm."),
        eveningCheckInTime: z.string().optional().describe("Local time like 17:00 or 5pm."),
        nightReviewTime: z.string().optional().describe("Local time like 21:00 or 9pm."),
      },
      async (args) => {
        const tzInfo = await describeUserNow();
        const result = await convex.mutation(api.accountability.upsertDailyPlan, {
          conversationId,
          localDate: tzInfo.isoDate,
          timezone: tzInfo.timezone,
          journal: args.journal,
          energy: args.energy,
          mood: args.mood,
          blockers: args.blockers,
          definitionOfDone: args.definitionOfDone,
          objectives: args.objectives,
        });

        let automationSummary = "check-ins unchanged";
        if (args.scheduleCheckIns) {
          const automations = await ensureAccountabilityAutomations(conversationId, {
            midday: args.middayCheckInTime,
            evening: args.eveningCheckInTime,
            night: args.nightReviewTime,
          });
          const created = automations.created.map((a) => a.name).join(", ") || "none";
          const skipped = automations.skipped.length ? `; already existed: ${automations.skipped.join(", ")}` : "";
          const invalid = automations.invalid.length
            ? `; invalid times skipped: ${automations.invalid.map((i) => `${i.name}=${i.time}`).join(", ")}`
            : "";
          const tzNote = automations.timezoneIsExplicit
            ? automations.timezone
            : `${automations.timezone} fallback`;
          automationSummary = `created check-ins: ${created}${skipped}${invalid}; timezone: ${tzNote}`;
        }

        return runtimeText(
          `Daily contract saved for ${tzInfo.isoDate}: ${result.objectiveCount} objectives. ${automationSummary}.`,
        );
      },
    ),

    defineRuntimeTool(
      NAMESPACE,
      "get_daily_contract",
      "Read the user's daily contract for today, or a specific local date. Use this before progress check-ins and night review.",
      {
        localDate: z.string().optional().describe("YYYY-MM-DD in the user's local timezone."),
      },
      async (args) => {
        const tzInfo = await describeUserNow();
        const localDate = args.localDate ?? tzInfo.isoDate;
        const result = await convex.query(api.accountability.getDailyPlan, {
          conversationId,
          localDate,
        });
        if (!result) return runtimeText(`No daily contract found for ${localDate}.`, false);
        const lines = result.objectives.map(
          (objective, index) => `${index + 1}. [${objective.status}] ${objective.text}`,
        );
        return runtimeText(
          `Daily contract for ${localDate} (${result.plan.status}):\n${lines.join("\n")}`,
        );
      },
    ),

    defineRuntimeTool(
      NAMESPACE,
      "update_daily_progress",
      "Update objective progress for today's daily contract. Use this when the user reports starting, progress, proof, stuck points, or slipped objectives.",
      {
        localDate: z.string().optional().describe("YYYY-MM-DD in the user's local timezone."),
        progressNote: z.string().optional().describe("Short summary of the user's progress update."),
        objectiveStatuses: z
          .array(
            z.object({
              index: z.number().int().min(1).describe("1-based objective number."),
              status: objectiveStatus,
              proof: z.string().optional().describe("Concrete proof or shipped artifact."),
              notes: z.string().optional().describe("Short note about this objective."),
            }),
          )
          .min(1),
      },
      async (args) => {
        const tzInfo = await describeUserNow();
        const result = await convex.mutation(api.accountability.updateProgress, {
          conversationId,
          localDate: args.localDate ?? tzInfo.isoDate,
          progressNote: args.progressNote,
          objectiveStatuses: args.objectiveStatuses,
        });
        if (result.missingPlan) {
          return runtimeText("No daily contract exists yet. Create one before tracking progress.", false);
        }
        return runtimeText(`Updated ${result.updated} daily objective(s).`);
      },
    ),

    defineRuntimeTool(
      NAMESPACE,
      "record_night_review",
      "Record the end-of-day review for a daily contract. Use this at night when the user reports what got completed, what slipped, the lesson, and tomorrow's adjustment.",
      {
        localDate: z.string().optional().describe("YYYY-MM-DD in the user's local timezone."),
        completedSummary: z.string(),
        slippedSummary: z.string(),
        lesson: z.string(),
        tomorrowAdjustment: z.string(),
        objectiveStatuses: z
          .array(
            z.object({
              index: z.number().int().min(1).describe("1-based objective number."),
              status: objectiveStatus,
              proof: z.string().optional(),
              notes: z.string().optional(),
            }),
          )
          .optional(),
      },
      async (args) => {
        const tzInfo = await describeUserNow();
        const result = await convex.mutation(api.accountability.recordNightReview, {
          conversationId,
          localDate: args.localDate ?? tzInfo.isoDate,
          completedSummary: args.completedSummary,
          slippedSummary: args.slippedSummary,
          lesson: args.lesson,
          tomorrowAdjustment: args.tomorrowAdjustment,
          objectiveStatuses: args.objectiveStatuses,
        });
        if (result.missingPlan) {
          return runtimeText("No daily contract exists yet. Ask for the day's objectives first.", false);
        }
        return runtimeText(`Night review saved. Updated ${result.updated} objective(s).`);
      },
    ),
  ];
}

export function createAccountabilityMcp(conversationId: string) {
  return createClaudeMcpServer(NAMESPACE, createAccountabilityTools(conversationId));
}

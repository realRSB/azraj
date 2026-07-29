// The user's hand on the dial.
//
// A proactive texter that can't be turned down is spam, and "stop texting me"
// has to work the first time it's said, in plain language, without the user
// learning a command. This gives the dispatcher one tool for exactly that, so
// "chill out" / "hit me harder" / "don't text me before 10" land as durable
// settings instead of a promise the next tick forgets.

import { z } from "zod";
import { api } from "../../convex/_generated/api.js";
import { convex } from "../convex-client.js";
import { defineRuntimeTool } from "../runtimes/tool.js";
import { runtimeText, type RuntimeTool } from "../runtimes/types.js";
import { parseTimeToHour } from "../weekly/schedule.js";
import { defaultNudgeState, type NudgeIntensity } from "./types.js";

const NAMESPACE = "boop-nudge";

const CADENCE: Record<NudgeIntensity, string> = {
  off: "no unprompted texts at all",
  chill: "at most 1 unprompted text a day",
  normal: "up to 2 unprompted texts a day",
  hard: "up to 4 unprompted texts a day",
};

function describeHour(hour: number): string {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}${hour < 12 ? "am" : "pm"}`;
}

// Accepts either a Convex row (absent optionals) or an in-memory NudgeState
// (nulls), since the read path falls back to defaultNudgeState().
function describe(row: {
  intensity: NudgeIntensity;
  quietStartHour: number;
  quietEndHour: number;
  snoozeUntil?: number | null;
}): string {
  const parts = [CADENCE[row.intensity]];
  if (row.intensity !== "off") {
    parts.push(
      `only between ${describeHour(row.quietStartHour)} and ${describeHour(row.quietEndHour)} their time`,
    );
    if (row.snoozeUntil && row.snoozeUntil > Date.now()) {
      const hours = Math.ceil((row.snoozeUntil - Date.now()) / 3_600_000);
      parts.push(`currently backed off for ~${hours}h after unanswered check-ins`);
    }
  }
  return parts.join("; ");
}

export function createNudgeTools(conversationId: string): RuntimeTool[] {
  return [
    defineRuntimeTool(
      NAMESPACE,
      "set_checkin_preference",
      // The description is the whole interface as far as the model is concerned,
      // so it spells out the natural-language triggers rather than the schema.
      `Control how often you text this user WITHOUT them messaging first, and during which hours. Call this whenever they push back on or ask about your unprompted check-ins.

Set intensity to "off" the moment they want you to stop ("stop texting me", "leave me alone", "turn the check-ins off"). Use "chill" when they want fewer but not none ("you're texting too much", "ease up", "once a day max"). Use "hard" when they explicitly want more pressure ("stay on me", "hit me harder", "check in more"). Use "normal" to restore the default.

Use earliestTime/latestTime for hour limits ("don't text me before 10am", "nothing after 9pm").

Call with NO arguments to read their current setting without changing anything — do that when they ask how often you check in.

Setting this does not affect reminders or check-ins the user explicitly asked you to schedule; those are automations.`,
      {
        intensity: z
          .enum(["off", "chill", "normal", "hard"])
          .optional()
          .describe("How much unprompted texting the user wants."),
        earliestTime: z
          .string()
          .optional()
          .describe('Earliest local hour you may text, e.g. "10am", "9", "noon".'),
        latestTime: z
          .string()
          .optional()
          .describe('Latest local hour you may text, e.g. "9pm", "21:00".'),
      },
      async (args) => {
        const patch: {
          intensity?: NudgeIntensity;
          quietStartHour?: number;
          quietEndHour?: number;
        } = {};
        const rejected: string[] = [];

        if (args.intensity) patch.intensity = args.intensity;
        if (args.earliestTime !== undefined) {
          const hour = parseTimeToHour(args.earliestTime);
          if (hour === null) rejected.push(`earliestTime "${args.earliestTime}"`);
          else patch.quietStartHour = hour;
        }
        if (args.latestTime !== undefined) {
          const hour = parseTimeToHour(args.latestTime);
          if (hour === null) rejected.push(`latestTime "${args.latestTime}"`);
          else patch.quietEndHour = hour;
        }
        if (rejected.length) {
          return runtimeText(
            `Couldn't read ${rejected.join(" and ")}. Ask for a plain clock time like "10am" or "9pm".`,
            false,
          );
        }

        // No arguments is a read. Fall back to the shared defaults so the answer
        // is right even before a row exists for this conversation.
        if (!Object.keys(patch).length) {
          const existing = await convex.query(api.nudges.get, { conversationId });
          const row = existing ?? { ...defaultNudgeState() };
          return runtimeText(`Current check-in setting: ${describe(row)}.`);
        }

        const saved = await convex.mutation(api.nudges.setPreference, {
          conversationId,
          ...patch,
        });
        if (!saved) return runtimeText("Couldn't save the check-in preference.", false);
        return runtimeText(`Check-in preference updated: ${describe(saved)}.`);
      },
    ),
  ];
}

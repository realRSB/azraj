import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

const intensityV = v.union(
  v.literal("off"),
  v.literal("chill"),
  v.literal("normal"),
  v.literal("hard"),
);

// Mirrors defaultNudgeState() in server/nudge/types.ts. Duplicated because
// Convex functions can't import from server/; keep the two in step.
const DEFAULT_INTENSITY = "normal" as const;
const DEFAULT_QUIET_START_HOUR = 9;
const DEFAULT_QUIET_END_HOUR = 22;

// One row per conversation, so the loop's per-tick read is bounded by the number
// of people using Azraj rather than by history.
const MAX_ROWS = 500;

export const get = query({
  args: { conversationId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("nudgeState")
      .withIndex("by_conversation", (q) => q.eq("conversationId", args.conversationId))
      .unique();
  },
});

export const listAll = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("nudgeState").take(MAX_ROWS);
  },
});

// Full-state write. The engine computes the next state in memory (pure patch
// merge in server/nudge/policy.ts) and commits it in one shot, which keeps the
// null-vs-undefined boundary in exactly one place and means a partial write can
// never leave the counters disagreeing with each other.
export const save = mutation({
  args: {
    conversationId: v.string(),
    intensity: intensityV,
    quietStartHour: v.number(),
    quietEndHour: v.number(),
    lastNudgeAt: v.optional(v.number()),
    lastNudgeKind: v.optional(v.string()),
    awaitingReply: v.boolean(),
    countDate: v.optional(v.string()),
    countToday: v.number(),
    consecutiveIgnored: v.number(),
    snoozeUntil: v.optional(v.number()),
    kindLastSent: v.record(v.string(), v.number()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("nudgeState")
      .withIndex("by_conversation", (q) => q.eq("conversationId", args.conversationId))
      .unique();
    const row = { ...args, updatedAt: Date.now() };
    if (existing) {
      // replace (not patch) so fields the engine cleared actually go away.
      await ctx.db.replace(existing._id, row);
      return existing._id;
    }
    return await ctx.db.insert("nudgeState", row);
  },
});

// The user-facing half: "chill out", "hit me harder", "don't text me before 10".
// Patches only the preference fields so it can run mid-conversation without
// disturbing the send counters or backoff state.
export const setPreference = mutation({
  args: {
    conversationId: v.string(),
    intensity: v.optional(intensityV),
    quietStartHour: v.optional(v.number()),
    quietEndHour: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { conversationId, ...prefs } = args;
    const patch = Object.fromEntries(
      Object.entries(prefs).filter(([, value]) => value !== undefined),
    );
    const existing = await ctx.db
      .query("nudgeState")
      .withIndex("by_conversation", (q) => q.eq("conversationId", conversationId))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, { ...patch, updatedAt: Date.now() });
      return await ctx.db.get(existing._id);
    }

    const id = await ctx.db.insert("nudgeState", {
      conversationId,
      intensity: DEFAULT_INTENSITY,
      quietStartHour: DEFAULT_QUIET_START_HOUR,
      quietEndHour: DEFAULT_QUIET_END_HOUR,
      awaitingReply: false,
      countToday: 0,
      consecutiveIgnored: 0,
      kindLastSent: {},
      ...patch,
      updatedAt: Date.now(),
    });
    return await ctx.db.get(id);
  },
});

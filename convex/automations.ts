import { mutation, query, type QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import { DEMO_SCAN_LIMIT, isDemoAutomationRun, isDemoId, isDemoModeEnabled } from "./demoMode";

export const create = mutation({
  args: {
    automationId: v.string(),
    name: v.string(),
    task: v.string(),
    integrations: v.array(v.string()),
    schedule: v.string(),
    timezone: v.optional(v.string()),
    conversationId: v.optional(v.string()),
    notifyConversationId: v.optional(v.string()),
    nextRunAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("automations")
      .withIndex("by_automation_id", (q) => q.eq("automationId", args.automationId))
      .unique();
    if (existing) return existing._id;
    return await ctx.db.insert("automations", {
      ...args,
      enabled: true,
      createdAt: Date.now(),
    });
  },
});

async function readAutomations(
  ctx: QueryCtx,
  opts: { enabledOnly?: boolean; conversationId?: string; demoOnly: boolean },
) {
  const { conversationId } = opts;
  const rows =
    conversationId !== undefined
      ? await ctx.db
          .query("automations")
          .withIndex("by_conversation", (q) => q.eq("conversationId", conversationId))
          .order("desc")
          .take(DEMO_SCAN_LIMIT)
      : opts.enabledOnly
        ? await ctx.db
            .query("automations")
            .withIndex("by_enabled", (q) => q.eq("enabled", true))
            .order("desc")
            .take(DEMO_SCAN_LIMIT)
        : await ctx.db.query("automations").order("desc").take(DEMO_SCAN_LIMIT);
  return rows.filter(
    (automation) =>
      isDemoId(automation.automationId) === opts.demoOnly &&
      // Only needed on the by_conversation path; the by_enabled index already
      // expressed this predicate on the other one.
      (!opts.enabledOnly || automation.enabled),
  );
}

// `conversationId` scopes the result to one conversation's automations. Pass it
// for anything a user or the dispatcher sees: without it this returns EVERY
// conversation's automations, which leaked one user's check-ins into another's
// prompt (see server/situation.ts). Omit it only for genuinely global callers —
// the scheduler tick in server/automations.ts, which must consider all of them.
export const list = query({
  args: { enabledOnly: v.optional(v.boolean()), conversationId: v.optional(v.string()) },
  handler: async (ctx, args) =>
    readAutomations(ctx, {
      enabledOnly: args.enabledOnly,
      conversationId: args.conversationId,
      demoOnly: false,
    }),
});

export const listForDashboard = query({
  args: { enabledOnly: v.optional(v.boolean()), conversationId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    return readAutomations(ctx, {
      enabledOnly: args.enabledOnly,
      conversationId: args.conversationId,
      demoOnly: await isDemoModeEnabled(ctx),
    });
  },
});

export const get = query({
  args: { automationId: v.string() },
  handler: async (ctx, args) => {
    if (isDemoId(args.automationId)) return null;
    return await ctx.db
      .query("automations")
      .withIndex("by_automation_id", (q) => q.eq("automationId", args.automationId))
      .unique();
  },
});

export const getForDashboard = query({
  args: { automationId: v.string() },
  handler: async (ctx, args) => {
    if (isDemoId(args.automationId) !== (await isDemoModeEnabled(ctx))) return null;
    return await ctx.db
      .query("automations")
      .withIndex("by_automation_id", (q) => q.eq("automationId", args.automationId))
      .unique();
  },
});

// Optional ownership guard for the two mutations that act on a bare id.
//
// Passing `conversationId` asserts "this automation must belong to that
// conversation", and a mismatch is reported as not-found rather than acted on.
// The dispatcher's tools pass it so a turn in one conversation can never toggle
// or delete another's check-in. It stays optional because the local debug
// dashboard is an operator view across all conversations and legitimately has no
// single conversation to scope to.
function ownedBy(
  auto: { conversationId?: string },
  conversationId: string | undefined,
): boolean {
  return conversationId === undefined || auto.conversationId === conversationId;
}

export const setEnabled = mutation({
  args: {
    automationId: v.string(),
    enabled: v.boolean(),
    conversationId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const auto = await ctx.db
      .query("automations")
      .withIndex("by_automation_id", (q) => q.eq("automationId", args.automationId))
      .unique();
    if (!auto || !ownedBy(auto, args.conversationId)) return null;
    await ctx.db.patch(auto._id, { enabled: args.enabled });
    return auto._id;
  },
});

export const remove = mutation({
  args: { automationId: v.string(), conversationId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const auto = await ctx.db
      .query("automations")
      .withIndex("by_automation_id", (q) => q.eq("automationId", args.automationId))
      .unique();
    if (!auto || !ownedBy(auto, args.conversationId)) return null;
    await ctx.db.delete(auto._id);
    return auto._id;
  },
});

export const markRan = mutation({
  args: {
    automationId: v.string(),
    lastRunAt: v.number(),
    nextRunAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const auto = await ctx.db
      .query("automations")
      .withIndex("by_automation_id", (q) => q.eq("automationId", args.automationId))
      .unique();
    if (!auto) return null;
    await ctx.db.patch(auto._id, {
      lastRunAt: args.lastRunAt,
      nextRunAt: args.nextRunAt,
    });
    return auto._id;
  },
});

export const createRun = mutation({
  args: {
    runId: v.string(),
    automationId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("automationRuns", {
      ...args,
      status: "running",
      startedAt: Date.now(),
    });
  },
});

export const updateRun = mutation({
  args: {
    runId: v.string(),
    status: v.union(v.literal("running"), v.literal("completed"), v.literal("failed")),
    result: v.optional(v.string()),
    error: v.optional(v.string()),
    agentId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db
      .query("automationRuns")
      .withIndex("by_run_id", (q) => q.eq("runId", args.runId))
      .unique();
    if (!run) return null;
    const completed = args.status !== "running";
    const { runId: _runId, ...patch } = args;
    await ctx.db.patch(run._id, {
      ...patch,
      ...(completed ? { completedAt: Date.now() } : {}),
    });
    return run._id;
  },
});

export const recentRuns = query({
  args: { automationId: v.optional(v.string()), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;
    if (args.automationId && isDemoId(args.automationId)) return [];
    if (args.automationId) {
      return (await ctx.db
        .query("automationRuns")
        .withIndex("by_automation", (q) => q.eq("automationId", args.automationId!))
        .order("desc")
        .take(DEMO_SCAN_LIMIT))
        .filter((run) => !isDemoAutomationRun(run))
        .slice(0, limit);
    }
    const rows = await ctx.db
      .query("automationRuns")
      .order("desc")
      .take(DEMO_SCAN_LIMIT);
    return rows.filter((run) => !isDemoAutomationRun(run)).slice(0, limit);
  },
});

export const recentRunsForDashboard = query({
  args: { automationId: v.optional(v.string()), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;
    const demoOnly = await isDemoModeEnabled(ctx);
    if (args.automationId && isDemoId(args.automationId) !== demoOnly) return [];
    const rows = args.automationId
      ? await ctx.db
          .query("automationRuns")
          .withIndex("by_automation", (q) => q.eq("automationId", args.automationId!))
          .order("desc")
          .take(DEMO_SCAN_LIMIT)
      : await ctx.db.query("automationRuns").order("desc").take(DEMO_SCAN_LIMIT);
    return rows.filter((run) => isDemoAutomationRun(run) === demoOnly).slice(0, limit);
  },
});

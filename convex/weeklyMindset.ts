import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

const statusV = v.union(
  v.literal("awaiting_schedule"),
  v.literal("active"),
  v.literal("disabled"),
);

export const get = query({
  args: { conversationId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("weeklyMindset")
      .withIndex("by_conversation", (q) => q.eq("conversationId", args.conversationId))
      .unique();
  },
});

export const listAll = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("weeklyMindset").collect();
  },
});

// Create the onboarding row (status=awaiting_schedule) if none exists yet.
// Idempotent — returns created:false when a row is already present, so the
// service never double-sends the onboarding ask.
export const startOnboarding = mutation({
  args: { conversationId: v.string(), timezone: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("weeklyMindset")
      .withIndex("by_conversation", (q) => q.eq("conversationId", args.conversationId))
      .unique();
    if (existing) return { created: false };
    await ctx.db.insert("weeklyMindset", {
      conversationId: args.conversationId,
      timezone: args.timezone,
      status: "awaiting_schedule",
      onboardingSentAt: Date.now(),
      updatedAt: Date.now(),
    });
    return { created: true };
  },
});

// Save the user's chosen slot and activate. `firstDropPending` makes the very
// first drop fire on the next tick instead of waiting up to a week.
export const setSchedule = mutation({
  args: {
    conversationId: v.string(),
    timezone: v.string(),
    preferredWeekday: v.number(),
    preferredHour: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("weeklyMindset")
      .withIndex("by_conversation", (q) => q.eq("conversationId", args.conversationId))
      .unique();
    const patch = {
      timezone: args.timezone,
      status: "active" as const,
      preferredWeekday: args.preferredWeekday,
      preferredHour: args.preferredHour,
      firstDropPending: true,
      updatedAt: now,
    };
    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return { row: await ctx.db.get(existing._id) };
    }
    const id = await ctx.db.insert("weeklyMindset", {
      conversationId: args.conversationId,
      ...patch,
    });
    return { row: await ctx.db.get(id) };
  },
});

// Record a completed drop: store this week's content, anchor the slot it was
// sent for, and reset the mid-week insight flags.
export const recordDrop = mutation({
  args: {
    conversationId: v.string(),
    slot: v.string(),
    weekContent: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("weeklyMindset")
      .withIndex("by_conversation", (q) => q.eq("conversationId", args.conversationId))
      .unique();
    if (!existing) return;
    const now = Date.now();
    await ctx.db.patch(existing._id, {
      lastDropSlot: args.slot,
      dropSentAt: now,
      weekContent: args.weekContent,
      insightsSent: [false, false, false],
      firstDropPending: false,
      updatedAt: now,
    });
  },
});

export const markInsightSent = mutation({
  args: { conversationId: v.string(), index: v.number() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("weeklyMindset")
      .withIndex("by_conversation", (q) => q.eq("conversationId", args.conversationId))
      .unique();
    if (!existing) return;
    const sent = [...(existing.insightsSent ?? [false, false, false])];
    if (args.index >= 0 && args.index < sent.length) sent[args.index] = true;
    await ctx.db.patch(existing._id, { insightsSent: sent, updatedAt: Date.now() });
  },
});

export const setStatus = mutation({
  args: { conversationId: v.string(), status: statusV },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("weeklyMindset")
      .withIndex("by_conversation", (q) => q.eq("conversationId", args.conversationId))
      .unique();
    if (!existing) return;
    await ctx.db.patch(existing._id, { status: args.status, updatedAt: Date.now() });
  },
});

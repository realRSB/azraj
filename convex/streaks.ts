import { mutation, query } from "./_generated/server.js";
import { v } from "convex/values";
import { advanceStreak } from "./streakLogic.js";

export const get = query({
  args: { conversationId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("streaks")
      .withIndex("by_conversation", (q) => q.eq("conversationId", args.conversationId))
      .unique();
  },
});

export const listAll = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("streaks").collect();
  },
});

// Register today's activity for a conversation. `today` is the user's local
// date (YYYY-MM-DD) and `timezone` its IANA id, both resolved by the caller.
// Returns the updated row plus whether this call advanced the streak (so the
// caller can, e.g., celebrate a milestone) — idempotent within a single day.
export const touch = mutation({
  args: {
    conversationId: v.string(),
    today: v.string(),
    timezone: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("streaks")
      .withIndex("by_conversation", (q) => q.eq("conversationId", args.conversationId))
      .unique();

    if (!existing) {
      const id = await ctx.db.insert("streaks", {
        conversationId: args.conversationId,
        currentStreak: 1,
        longestStreak: 1,
        totalDays: 1,
        lastActiveDate: args.today,
        timezone: args.timezone,
        updatedAt: now,
      });
      const row = await ctx.db.get(id);
      return { row, advanced: true, milestone: true, reset: false };
    }

    const next = advanceStreak(existing, args.today);
    // Same local day (or a clock that ran backwards) — nothing to advance,
    // but keep the timezone fresh in case the user moved / corrected it.
    if (!next.changed) {
      if (existing.timezone !== args.timezone) {
        await ctx.db.patch(existing._id, { timezone: args.timezone, updatedAt: now });
      }
      const row = await ctx.db.get(existing._id);
      return { row, advanced: false, milestone: false, reset: false };
    }

    await ctx.db.patch(existing._id, {
      currentStreak: next.currentStreak,
      longestStreak: next.longestStreak,
      totalDays: next.totalDays,
      lastActiveDate: args.today,
      timezone: args.timezone,
      updatedAt: now,
    });
    const row = await ctx.db.get(existing._id);
    return {
      row,
      advanced: true,
      milestone: next.currentStreak === next.longestStreak,
      reset: next.reset,
    };
  },
});

// Manual/admin correction of a streak's counters — used to repair data drift
// (e.g. a streak that was undercounted while inbound texts were split across two
// instances). Requires the row to already exist. Leaves lastCardDate untouched;
// longestStreak/totalDays are floored at currentStreak so they stay consistent.
export const adminSet = mutation({
  args: {
    conversationId: v.string(),
    currentStreak: v.number(),
    longestStreak: v.optional(v.number()),
    totalDays: v.optional(v.number()),
    lastActiveDate: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (!Number.isInteger(args.currentStreak) || args.currentStreak < 0) {
      return { ok: false as const, reason: "currentStreak must be a non-negative integer" };
    }
    const existing = await ctx.db
      .query("streaks")
      .withIndex("by_conversation", (q) => q.eq("conversationId", args.conversationId))
      .unique();
    if (!existing) {
      return { ok: false as const, reason: "no streak row for that conversation" };
    }
    const longestStreak = Math.max(args.longestStreak ?? existing.longestStreak, args.currentStreak);
    const totalDays = Math.max(args.totalDays ?? existing.totalDays, args.currentStreak);
    await ctx.db.patch(existing._id, {
      currentStreak: args.currentStreak,
      longestStreak,
      totalDays,
      lastActiveDate: args.lastActiveDate ?? existing.lastActiveDate,
      updatedAt: Date.now(),
    });
    return { ok: true as const, row: await ctx.db.get(existing._id) };
  },
});

export const markCardSent = mutation({
  args: { conversationId: v.string(), date: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("streaks")
      .withIndex("by_conversation", (q) => q.eq("conversationId", args.conversationId))
      .unique();
    if (!existing) return;
    await ctx.db.patch(existing._id, { lastCardDate: args.date, updatedAt: Date.now() });
  },
});

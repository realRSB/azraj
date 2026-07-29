import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const create = mutation({
  args: {
    expenseId: v.string(),
    conversationId: v.string(),
    amountCents: v.number(),
    currency: v.string(),
    category: v.optional(v.string()),
    note: v.optional(v.string()),
    spentAt: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("expenses", { ...args, createdAt: Date.now() });
  },
});

export const listForConversation = query({
  args: { conversationId: v.string(), sinceMs: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("expenses")
      .withIndex("by_conversation_spent_at", (q) =>
        args.sinceMs === undefined
          ? q.eq("conversationId", args.conversationId)
          : q.eq("conversationId", args.conversationId).gte("spentAt", args.sinceMs),
      )
      .order("desc")
      .take(500);
    return rows;
  },
});

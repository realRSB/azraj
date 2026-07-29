import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const create = mutation({
  args: { itemId: v.string(), conversationId: v.string(), text: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db.insert("listItems", {
      ...args,
      status: "open",
      createdAt: Date.now(),
    });
  },
});

export const listForConversation = query({
  args: { conversationId: v.string(), statusFilter: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("listItems")
      .withIndex("by_conversation_status", (q) => q.eq("conversationId", args.conversationId))
      .order("desc")
      .take(200);
    return args.statusFilter ? rows.filter((r) => r.status === args.statusFilter) : rows;
  },
});

export const complete = mutation({
  args: { itemId: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("listItems")
      .withIndex("by_item_id", (q) => q.eq("itemId", args.itemId))
      .unique();
    if (!row || row.status !== "open") return null;
    await ctx.db.patch(row._id, { status: "done", completedAt: Date.now() });
    return row._id;
  },
});

export const remove = mutation({
  args: { itemId: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("listItems")
      .withIndex("by_item_id", (q) => q.eq("itemId", args.itemId))
      .unique();
    if (!row) return null;
    await ctx.db.delete(row._id);
    return row._id;
  },
});

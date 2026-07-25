import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";

const objectiveStatus = v.union(
  v.literal("pending"),
  v.literal("started"),
  v.literal("done"),
  v.literal("slipped"),
);

async function getPlanByDate(
  ctx: QueryCtx | MutationCtx,
  conversationId: string,
  localDate: string,
) {
  return await ctx.db
    .query("dailyPlans")
    .withIndex("by_conversation_and_localDate", (q) =>
      q.eq("conversationId", conversationId).eq("localDate", localDate),
    )
    .unique();
}

async function getObjectives(
  ctx: QueryCtx | MutationCtx,
  planId: Id<"dailyPlans">,
) {
  return await ctx.db
    .query("dailyObjectives")
    .withIndex("by_plan", (q) => q.eq("planId", planId))
    .collect();
}

export const upsertDailyPlan = mutation({
  args: {
    conversationId: v.string(),
    localDate: v.string(),
    timezone: v.string(),
    journal: v.optional(v.string()),
    energy: v.optional(v.string()),
    mood: v.optional(v.string()),
    blockers: v.optional(v.string()),
    definitionOfDone: v.optional(v.string()),
    objectives: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await getPlanByDate(ctx, args.conversationId, args.localDate);
    const planPatch = {
      conversationId: args.conversationId,
      localDate: args.localDate,
      timezone: args.timezone,
      status: "planned" as const,
      journal: args.journal,
      energy: args.energy,
      mood: args.mood,
      blockers: args.blockers,
      definitionOfDone: args.definitionOfDone,
      updatedAt: now,
    };

    const planId = existing
      ? existing._id
      : await ctx.db.insert("dailyPlans", {
          ...planPatch,
          createdAt: now,
        });

    if (existing) {
      await ctx.db.patch(existing._id, planPatch);
      const oldObjectives = await getObjectives(ctx, existing._id);
      for (const objective of oldObjectives) {
        await ctx.db.delete(objective._id);
      }
    }

    for (const text of args.objectives.map((objective) => objective.trim()).filter(Boolean)) {
      await ctx.db.insert("dailyObjectives", {
        planId,
        conversationId: args.conversationId,
        localDate: args.localDate,
        text,
        status: "pending",
        createdAt: now,
        updatedAt: now,
      });
    }

    return { planId, objectiveCount: args.objectives.filter((objective) => objective.trim()).length };
  },
});

export const getDailyPlan = query({
  args: {
    conversationId: v.string(),
    localDate: v.string(),
  },
  handler: async (ctx, args) => {
    const plan = await getPlanByDate(ctx, args.conversationId, args.localDate);
    if (!plan) return null;
    const objectives = (await getObjectives(ctx, plan._id)).sort(
      (a, b) => a.createdAt - b.createdAt,
    );
    return { plan, objectives };
  },
});

export const updateProgress = mutation({
  args: {
    conversationId: v.string(),
    localDate: v.string(),
    progressNote: v.optional(v.string()),
    objectiveStatuses: v.array(
      v.object({
        index: v.number(),
        status: objectiveStatus,
        proof: v.optional(v.string()),
        notes: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const plan = await getPlanByDate(ctx, args.conversationId, args.localDate);
    if (!plan) return { updated: 0, missingPlan: true };

    const now = Date.now();
    const objectives = (await getObjectives(ctx, plan._id)).sort(
      (a, b) => a.createdAt - b.createdAt,
    );
    let updated = 0;
    for (const update of args.objectiveStatuses) {
      const objective = objectives[update.index - 1];
      if (!objective) continue;
      await ctx.db.patch(objective._id, {
        status: update.status,
        proof: update.proof,
        notes: update.notes,
        updatedAt: now,
      });
      updated += 1;
    }

    await ctx.db.patch(plan._id, {
      status: "in_progress",
      progressNote: args.progressNote,
      lastProgressAt: now,
      updatedAt: now,
    });

    return { updated, missingPlan: false };
  },
});

export const recordNightReview = mutation({
  args: {
    conversationId: v.string(),
    localDate: v.string(),
    completedSummary: v.string(),
    slippedSummary: v.string(),
    lesson: v.string(),
    tomorrowAdjustment: v.string(),
    objectiveStatuses: v.optional(
      v.array(
        v.object({
          index: v.number(),
          status: objectiveStatus,
          proof: v.optional(v.string()),
          notes: v.optional(v.string()),
        }),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const plan = await getPlanByDate(ctx, args.conversationId, args.localDate);
    if (!plan) return { reviewed: false, updated: 0, missingPlan: true };

    const now = Date.now();
    let updated = 0;
    if (args.objectiveStatuses) {
      const objectives = (await getObjectives(ctx, plan._id)).sort(
        (a, b) => a.createdAt - b.createdAt,
      );
      for (const update of args.objectiveStatuses) {
        const objective = objectives[update.index - 1];
        if (!objective) continue;
        await ctx.db.patch(objective._id, {
          status: update.status,
          proof: update.proof,
          notes: update.notes,
          updatedAt: now,
        });
        updated += 1;
      }
    }

    await ctx.db.patch(plan._id, {
      status: "reviewed",
      completedSummary: args.completedSummary,
      slippedSummary: args.slippedSummary,
      lesson: args.lesson,
      tomorrowAdjustment: args.tomorrowAdjustment,
      reviewedAt: now,
      updatedAt: now,
    });

    return { reviewed: true, updated, missingPlan: false };
  },
});

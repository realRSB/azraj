import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const DASHBOARD_SCAN_LIMIT = 5000;

type Ctx = QueryCtx | MutationCtx;
type AccountabilityPlanForDashboard = Doc<"dailyPlans"> & {
  objectives: Doc<"dailyObjectives">[];
};

async function getUserByPhone(ctx: Ctx, phoneE164: string) {
  return await ctx.db
    .query("users")
    .withIndex("by_phone", (q) => q.eq("phoneE164", phoneE164))
    .unique();
}

async function getSessionUser(ctx: Ctx, sessionToken: string) {
  const session = await ctx.db
    .query("userSessions")
    .withIndex("by_token", (q) => q.eq("sessionToken", sessionToken))
    .unique();
  if (!session || session.expiresAt < Date.now()) return null;
  const user = await ctx.db.get(session.userId);
  if (!user) return null;
  return { session, user };
}

async function ensureUser(ctx: MutationCtx, phoneE164: string) {
  const now = Date.now();
  const existing = await getUserByPhone(ctx, phoneE164);
  if (existing) {
    await ctx.db.patch(existing._id, { updatedAt: now, lastSeenAt: now });
    return existing._id;
  }
  return await ctx.db.insert("users", {
    phoneE164,
    onboardingStatus: "started",
    createdAt: now,
    updatedAt: now,
    lastSeenAt: now,
  });
}

async function linkConversation(
  ctx: MutationCtx,
  userId: Id<"users">,
  phoneE164: string,
  conversationId: string,
) {
  const now = Date.now();
  const existing = await ctx.db
    .query("userConversationLinks")
    .withIndex("by_conversation", (q) => q.eq("conversationId", conversationId))
    .unique();
  if (existing) {
    await ctx.db.patch(existing._id, { userId, phoneE164, lastLinkedAt: now });
    return existing._id;
  }
  return await ctx.db.insert("userConversationLinks", {
    userId,
    phoneE164,
    conversationId,
    verifiedAt: now,
    lastLinkedAt: now,
  });
}

export const issuePhoneOtp = mutation({
  args: {
    phoneE164: v.string(),
    codeHash: v.string(),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await ensureUser(ctx, args.phoneE164);
    const existingRows = await ctx.db
      .query("phoneOtps")
      .withIndex("by_phone", (q) => q.eq("phoneE164", args.phoneE164))
      .order("desc")
      .take(10);
    for (const row of existingRows) {
      if (!row.consumedAt) {
        await ctx.db.patch(row._id, { consumedAt: now });
      }
    }
    return await ctx.db.insert("phoneOtps", {
      phoneE164: args.phoneE164,
      codeHash: args.codeHash,
      attempts: 0,
      createdAt: now,
      expiresAt: args.expiresAt,
    });
  },
});

export const verifyPhoneOtp = mutation({
  args: {
    phoneE164: v.string(),
    codeHash: v.string(),
    sessionToken: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const otp = await ctx.db
      .query("phoneOtps")
      .withIndex("by_phone", (q) => q.eq("phoneE164", args.phoneE164))
      .order("desc")
      .first();
    if (!otp || otp.consumedAt || otp.expiresAt < now) {
      return { ok: false as const, reason: "expired" };
    }
    if (otp.attempts >= 5) {
      return { ok: false as const, reason: "locked" };
    }
    if (otp.codeHash !== args.codeHash) {
      await ctx.db.patch(otp._id, { attempts: otp.attempts + 1 });
      return { ok: false as const, reason: "invalid" };
    }

    const userId = await ensureUser(ctx, args.phoneE164);
    const conversationId = `sms:${args.phoneE164}`;
    await linkConversation(ctx, userId, args.phoneE164, conversationId);
    await ctx.db.patch(userId, {
      onboardingStatus: "connected",
      updatedAt: now,
      lastSeenAt: now,
    });
    await ctx.db.patch(otp._id, { consumedAt: now });
    await ctx.db.insert("userSessions", {
      userId,
      sessionToken: args.sessionToken,
      createdAt: now,
      lastSeenAt: now,
      expiresAt: now + SESSION_TTL_MS,
    });
    return { ok: true as const, sessionToken: args.sessionToken, conversationId };
  },
});

export const linkInboundConversation = mutation({
  args: {
    phoneE164: v.string(),
    conversationId: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await ensureUser(ctx, args.phoneE164);
    await linkConversation(ctx, userId, args.phoneE164, args.conversationId);
    await ctx.db.patch(userId, {
      onboardingStatus: "connected",
      updatedAt: Date.now(),
      lastSeenAt: Date.now(),
    });
    return userId;
  },
});

export const getSession = query({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    const result = await getSessionUser(ctx, args.sessionToken);
    if (!result) return null;
    const links = await ctx.db
      .query("userConversationLinks")
      .withIndex("by_user", (q) => q.eq("userId", result.user._id))
      .collect();
    const conversationIds = [
      ...new Set([
        ...links.map((link) => link.conversationId),
        `sms:${result.user.phoneE164}`,
      ]),
    ];
    return {
      userId: result.user._id,
      phoneE164: result.user.phoneE164,
      displayName: result.user.displayName,
      timezone: result.user.timezone,
      onboardingStatus: result.user.onboardingStatus,
      conversationIds,
    };
  },
});

export const setTimezone = mutation({
  args: { sessionToken: v.string(), timezone: v.string() },
  handler: async (ctx, args) => {
    const result = await getSessionUser(ctx, args.sessionToken);
    if (!result) return null;
    const now = Date.now();
    await ctx.db.patch(result.user._id, {
      timezone: args.timezone,
      updatedAt: now,
      lastSeenAt: now,
    });
    return {
      phoneE164: result.user.phoneE164,
      timezone: args.timezone,
    };
  },
});

export const logout = mutation({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("userSessions")
      .withIndex("by_token", (q) => q.eq("sessionToken", args.sessionToken))
      .unique();
    if (!session) return false;
    await ctx.db.delete(session._id);
    return true;
  },
});

export const dashboard = query({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    const result = await getSessionUser(ctx, args.sessionToken);
    if (!result) return null;
    const links = await ctx.db
      .query("userConversationLinks")
      .withIndex("by_user", (q) => q.eq("userId", result.user._id))
      .collect();
    const conversationIds = [
      ...new Set([
        ...links.map((link) => link.conversationId),
        `sms:${result.user.phoneE164}`,
      ]),
    ];
    const conversationSet = new Set(conversationIds);

    const [
      messages,
      memories,
      usageRecords,
      agents,
      automations,
      automationRuns,
      dailyPlans,
    ] = await Promise.all([
      Promise.all(
        conversationIds.map((conversationId) =>
          ctx.db
            .query("messages")
            .withIndex("by_conversation", (q) => q.eq("conversationId", conversationId))
            .order("desc")
            .take(80),
        ),
      ),
      Promise.all(
        conversationIds.map((conversationId) =>
          ctx.db
            .query("memoryRecords")
            .withIndex("by_conversation", (q) => q.eq("conversationId", conversationId))
            .order("desc")
            .take(250),
        ),
      ),
      Promise.all(
        conversationIds.map((conversationId) =>
          ctx.db
            .query("usageRecords")
            .withIndex("by_conversation", (q) => q.eq("conversationId", conversationId))
            .order("desc")
            .take(DASHBOARD_SCAN_LIMIT),
        ),
      ),
      ctx.db.query("executionAgents").order("desc").take(DASHBOARD_SCAN_LIMIT),
      ctx.db.query("automations").order("desc").take(DASHBOARD_SCAN_LIMIT),
      ctx.db.query("automationRuns").order("desc").take(DASHBOARD_SCAN_LIMIT),
      Promise.all(
        conversationIds.map((conversationId) =>
          ctx.db
            .query("dailyPlans")
            .withIndex("by_conversation", (q) => q.eq("conversationId", conversationId))
            .order("desc")
            .take(14),
        ),
      ),
    ]);

    const messageRows = messages.flat().sort((a, b) => b.createdAt - a.createdAt);
    const memoryRows = memories
      .flat()
      .filter((memory) => memory.lifecycle === "active")
      .sort((a, b) => b.createdAt - a.createdAt);
    const usageRows = usageRecords.flat();
    const agentRows = agents.filter(
      (agent) => agent.conversationId && conversationSet.has(agent.conversationId),
    );
    const automationRows = automations.filter(
      (automation) =>
        (automation.conversationId && conversationSet.has(automation.conversationId)) ||
        (automation.notifyConversationId && conversationSet.has(automation.notifyConversationId)),
    );
    const automationIds = new Set(automationRows.map((automation) => automation.automationId));
    const automationRunRows = automationRuns.filter((run) => automationIds.has(run.automationId));
    const planRows = dailyPlans.flat().sort((a, b) => b.updatedAt - a.updatedAt);
    const objectivesByPlan = new Map<Id<"dailyPlans">, Doc<"dailyObjectives">[]>();
    await Promise.all(
      planRows.map(async (plan) => {
        const objectives = await ctx.db
          .query("dailyObjectives")
          .withIndex("by_plan", (q) => q.eq("planId", plan._id))
          .collect();
        objectivesByPlan.set(
          plan._id,
          objectives.sort((a, b) => a.createdAt - b.createdAt),
        );
      }),
    );
    const objectiveRows = [...objectivesByPlan.values()].flat();
    const activePlan: AccountabilityPlanForDashboard | null = planRows[0]
      ? {
          ...planRows[0],
          objectives: objectivesByPlan.get(planRows[0]._id) ?? [],
        }
      : null;
    const recentPlans: AccountabilityPlanForDashboard[] = planRows.slice(0, 10).map((plan) => ({
      ...plan,
      objectives: objectivesByPlan.get(plan._id) ?? [],
    }));

    const dailyBuckets = new Map<
      string,
      {
        day: string;
        costUsd: number;
        inputTokens: number;
        outputTokens: number;
        messages: number;
        agentsSpawned: number;
        agentsCompleted: number;
        agentsFailed: number;
        agentsCancelled: number;
        automationRuns: number;
      }
    >();
    const bucketFor = (ts: number) => {
      const day = new Date(ts).toISOString().slice(0, 10);
      let bucket = dailyBuckets.get(day);
      if (!bucket) {
        bucket = {
          day,
          costUsd: 0,
          inputTokens: 0,
          outputTokens: 0,
          messages: 0,
          agentsSpawned: 0,
          agentsCompleted: 0,
          agentsFailed: 0,
          agentsCancelled: 0,
          automationRuns: 0,
        };
        dailyBuckets.set(day, bucket);
      }
      return bucket;
    };
    for (const row of usageRows) {
      const bucket = bucketFor(row.createdAt);
      bucket.costUsd += row.costUsd;
      bucket.inputTokens += row.inputTokens;
      bucket.outputTokens += row.outputTokens;
    }
    for (const row of messageRows) {
      bucketFor(row.createdAt).messages += 1;
    }
    for (const row of agentRows) {
      const bucket = bucketFor(row.startedAt);
      bucket.agentsSpawned += 1;
      if (row.status === "completed") bucket.agentsCompleted += 1;
      if (row.status === "failed") bucket.agentsFailed += 1;
      if (row.status === "cancelled") bucket.agentsCancelled += 1;
    }
    for (const row of automationRunRows) {
      bucketFor(row.startedAt).automationRuns += 1;
    }

    const totalCost = usageRows.reduce((sum, row) => sum + row.costUsd, 0);
    const inputTokens = usageRows.reduce((sum, row) => sum + row.inputTokens, 0);
    const outputTokens = usageRows.reduce((sum, row) => sum + row.outputTokens, 0);

    return {
      user: {
        phoneE164: result.user.phoneE164,
        displayName: result.user.displayName,
        timezone: result.user.timezone,
        onboardingStatus: result.user.onboardingStatus,
      },
      conversationIds,
      metrics: {
        messages: messageRows.length,
        memories: {
          total: memoryRows.length,
          shortTerm: memoryRows.filter((memory) => memory.tier === "short").length,
          longTerm: memoryRows.filter((memory) => memory.tier === "long").length,
          permanent: memoryRows.filter((memory) => memory.tier === "permanent").length,
        },
        agents: {
          total: agentRows.length,
          running: agentRows.filter(
            (agent) => agent.status === "running" || agent.status === "spawned",
          ).length,
          completed: agentRows.filter((agent) => agent.status === "completed").length,
          failed: agentRows.filter((agent) => agent.status === "failed").length,
          cancelled: agentRows.filter((agent) => agent.status === "cancelled").length,
        },
        automations: {
          total: automationRows.length,
          enabled: automationRows.filter((automation) => automation.enabled).length,
          runs: automationRunRows.length,
        },
        accountability: {
          plans: planRows.length,
          reviewed: planRows.filter((plan) => plan.status === "reviewed").length,
          objectives: objectiveRows.length,
          done: objectiveRows.filter((objective) => objective.status === "done").length,
          slipped: objectiveRows.filter((objective) => objective.status === "slipped").length,
          activeStatus: activePlan?.status,
        },
        usage: {
          totalCost,
          inputTokens,
          outputTokens,
          totalTokens: inputTokens + outputTokens,
        },
        dailyBuckets: [...dailyBuckets.values()].sort((a, b) => a.day.localeCompare(b.day)),
      },
      recentMessages: messageRows.slice(0, 20),
      memories: memoryRows.slice(0, 50),
      automations: automationRows.slice(0, 20),
      accountability: {
        activePlan,
        recentPlans,
      },
    };
  },
});

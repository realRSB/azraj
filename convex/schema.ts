import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    phoneE164: v.string(),
    displayName: v.optional(v.string()),
    timezone: v.optional(v.string()),
    onboardingStatus: v.union(v.literal("started"), v.literal("connected")),
    createdAt: v.number(),
    updatedAt: v.number(),
    lastSeenAt: v.optional(v.number()),
  }).index("by_phone", ["phoneE164"]),

  userSessions: defineTable({
    userId: v.id("users"),
    sessionToken: v.string(),
    createdAt: v.number(),
    lastSeenAt: v.number(),
    expiresAt: v.number(),
  }).index("by_token", ["sessionToken"]),

  dashboardMagicLinks: defineTable({
    userId: v.id("users"),
    phoneE164: v.string(),
    tokenHash: v.string(),
    createdAt: v.number(),
    expiresAt: v.number(),
    consumedAt: v.optional(v.number()),
  })
    .index("by_token_hash", ["tokenHash"])
    .index("by_phone", ["phoneE164"]),

  publicJoinCodes: defineTable({
    codeHash: v.string(),
    createdAt: v.number(),
    expiresAt: v.number(),
    consumedAt: v.optional(v.number()),
    phoneE164: v.optional(v.string()),
  }).index("by_code_hash", ["codeHash"]),

  phoneOtps: defineTable({
    phoneE164: v.string(),
    codeHash: v.string(),
    attempts: v.number(),
    createdAt: v.number(),
    expiresAt: v.number(),
    consumedAt: v.optional(v.number()),
  }).index("by_phone", ["phoneE164"]),

  userConversationLinks: defineTable({
    userId: v.id("users"),
    phoneE164: v.string(),
    conversationId: v.string(),
    verifiedAt: v.number(),
    lastLinkedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_phone", ["phoneE164"])
    .index("by_conversation", ["conversationId"]),

  messages: defineTable({
    conversationId: v.string(),
    role: v.union(v.literal("user"), v.literal("assistant"), v.literal("system")),
    content: v.string(),
    agentId: v.optional(v.string()),
    turnId: v.optional(v.string()),
    createdAt: v.number(),
    imageStorageIds: v.optional(v.array(v.id("_storage"))),
    mediaError: v.optional(v.string()),
  })
    .index("by_conversation", ["conversationId"])
    .index("by_conversation_turn", ["conversationId", "turnId"])
    .index("by_createdAt", ["createdAt"]),

  conversations: defineTable({
    conversationId: v.string(),
    title: v.optional(v.string()),
    summary: v.optional(v.string()),
    messageCount: v.number(),
    lastActivityAt: v.number(),
  }).index("by_conversation", ["conversationId"]),

  memoryRecords: defineTable({
    memoryId: v.string(),
    conversationId: v.optional(v.string()),
    content: v.string(),
    tier: v.union(v.literal("short"), v.literal("long"), v.literal("permanent")),
    segment: v.union(
      v.literal("identity"),
      v.literal("preference"),
      v.literal("correction"),
      v.literal("relationship"),
      v.literal("project"),
      v.literal("knowledge"),
      v.literal("context"),
    ),
    importance: v.number(),
    decayRate: v.number(),
    accessCount: v.number(),
    lastAccessedAt: v.number(),
    sourceTurn: v.optional(v.string()),
    lifecycle: v.union(v.literal("active"), v.literal("archived"), v.literal("pruned")),
    supersedes: v.optional(v.array(v.string())),
    embedding: v.optional(v.array(v.float64())),
    // Structured sidecar data (JSON blob). Currently used to carry
    // `corrects` text on correction-segment memories. Intentionally loose
    // so extraction prompts can stash provider-specific hints without
    // schema churn.
    metadata: v.optional(v.string()),
    createdAt: v.number(),
    imageStorageIds: v.optional(v.array(v.id("_storage"))),
  })
    .index("by_memory_id", ["memoryId"])
    .index("by_conversation", ["conversationId"])
    .index("by_tier", ["tier"])
    .index("by_segment", ["segment"])
    .index("by_lifecycle", ["lifecycle"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 1024,
      filterFields: ["lifecycle", "conversationId"],
    }),

  executionAgents: defineTable({
    agentId: v.string(),
    conversationId: v.optional(v.string()),
    name: v.string(),
    task: v.string(),
    runtime: v.optional(v.union(v.literal("claude"), v.literal("codex"))),
    model: v.optional(v.string()),
    reasoningEffort: v.optional(v.string()),
    billingMode: v.optional(v.union(v.literal("api"), v.literal("codex-subscription"))),
    status: v.union(
      v.literal("spawned"),
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("cancelled"),
      v.literal("paused"),
    ),
    result: v.optional(v.string()),
    error: v.optional(v.string()),
    mcpServers: v.array(v.string()),
    inputTokens: v.number(),
    outputTokens: v.number(),
    cacheReadTokens: v.optional(v.number()),
    cacheCreationTokens: v.optional(v.number()),
    costUsd: v.number(),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_agent_id", ["agentId"])
    .index("by_status", ["status"])
    .index("by_conversation", ["conversationId"]),

  // Append-only LLM usage log. Every model call (dispatcher, execution,
  // extract, consolidation) writes a row here so you can query total cost
  // by source, conversation, or time range.
  usageRecords: defineTable({
    source: v.union(
      v.literal("dispatcher"),
      v.literal("execution"),
      v.literal("extract"),
      v.literal("consolidation-proposer"),
      v.literal("consolidation-adversary"),
      v.literal("consolidation-judge"),
      v.literal("proactive"),
      v.literal("weekly"),
    ),
    conversationId: v.optional(v.string()),
    turnId: v.optional(v.string()),
    agentId: v.optional(v.string()),
    runId: v.optional(v.string()),
    runtime: v.optional(v.union(v.literal("claude"), v.literal("codex"))),
    billingMode: v.optional(v.union(v.literal("api"), v.literal("codex-subscription"))),
    model: v.string(),
    inputTokens: v.number(),
    outputTokens: v.number(),
    cacheReadTokens: v.number(),
    cacheCreationTokens: v.number(),
    costUsd: v.number(),
    durationMs: v.number(),
    createdAt: v.number(),
  })
    .index("by_conversation", ["conversationId"])
    .index("by_agent", ["agentId"])
    .index("by_source", ["source"]),

  agentLogs: defineTable({
    agentId: v.string(),
    logType: v.union(
      v.literal("thinking"),
      v.literal("tool_use"),
      v.literal("tool_result"),
      v.literal("text"),
      v.literal("error"),
    ),
    toolName: v.optional(v.string()),
    // Composio account aliases targeted by this tool call (e.g. ["gmail_charry-fusc"]).
    // Populated when the input names a specific connected account, so multi-account
    // toolkits make it visible which inbox / workspace was actually hit.
    accounts: v.optional(v.array(v.string())),
    content: v.string(),
    createdAt: v.number(),
  }).index("by_agent", ["agentId"]),

  memoryEvents: defineTable({
    eventType: v.string(),
    conversationId: v.optional(v.string()),
    memoryId: v.optional(v.string()),
    agentId: v.optional(v.string()),
    data: v.string(),
    createdAt: v.number(),
  })
    .index("by_conversation", ["conversationId"])
    .index("by_type", ["eventType"]),

  automations: defineTable({
    automationId: v.string(),
    name: v.string(),
    task: v.string(),
    integrations: v.array(v.string()),
    schedule: v.string(),
    // IANA timezone the cron expression is evaluated in. Stored at create
    // time so changing the user's global timezone later doesn't shift
    // existing automations. Optional for backwards compatibility — pre-TZ
    // automations fall back to the user's current setting at run time.
    timezone: v.optional(v.string()),
    enabled: v.boolean(),
    conversationId: v.optional(v.string()),
    notifyConversationId: v.optional(v.string()),
    lastRunAt: v.optional(v.number()),
    nextRunAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_automation_id", ["automationId"])
    .index("by_enabled", ["enabled"])
    .index("by_conversation", ["conversationId"])
    .index("by_notify_conversation", ["notifyConversationId"]),

  sendblueDedup: defineTable({
    handle: v.string(),
    claimedAt: v.number(),
  }).index("by_handle", ["handle"]),

  drafts: defineTable({
    draftId: v.string(),
    conversationId: v.string(),
    kind: v.string(),
    summary: v.string(),
    payload: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("sent"),
      v.literal("rejected"),
      v.literal("expired"),
    ),
    createdAt: v.number(),
    decidedAt: v.optional(v.number()),
  })
    .index("by_draft_id", ["draftId"])
    .index("by_conversation_status", ["conversationId", "status"]),

  consolidationRuns: defineTable({
    runId: v.string(),
    trigger: v.string(),
    status: v.union(
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed"),
    ),
    proposalsCount: v.number(),
    mergedCount: v.number(),
    prunedCount: v.number(),
    notes: v.optional(v.string()),
    // JSON blob: { proposals: [...], decisions: [...], applied: [...] }
    // Captured so you can inspect the reasoning for any historical run.
    details: v.optional(v.string()),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_run_id", ["runId"])
    .index("by_status", ["status"]),

  // Runtime overrides for things normally pinned by env vars (e.g. the Claude
  // model). Lets the user say "use opus" via iMessage and have the next agent
  // run respect it without a redeploy.
  settings: defineTable({
    key: v.string(),
    value: v.string(),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),

  // Per-conversation pause-and-resume slot. A sub-agent that hits a wall
  // requiring hand-action (login, OAuth, captcha, file pick) writes here and
  // ends its turn; the dispatcher picks this up on the next user message and
  // re-spawns with the saved resume task. Only one pending continuation per
  // conversation at a time.
  pendingContinuations: defineTable({
    conversationId: v.string(),
    resumeTask: v.string(),
    integrations: v.array(v.string()),
    pausedByAgentId: v.optional(v.string()),
    askedAt: v.number(),
  }).index("by_conversation", ["conversationId"]),

  // Cookie imports from the user's daily Chrome profile into boop's stealth
  // Chrome. One row per (service, profile) — re-importing updates the same
  // row. Identity is the Google email / handle we read off the source
  // profile so the UI can show "Active as user@example.com".
  cookieImports: defineTable({
    service: v.string(),
    sourceProfile: v.string(),
    identity: v.optional(v.string()),
    cookieCount: v.number(),
    lastImportedAt: v.number(),
    lastVerifiedAt: v.optional(v.number()),
    verifiedOk: v.optional(v.boolean()),
  }).index("by_service_profile", ["service", "sourceProfile"]).index("by_service", ["service"]),

  // Per-user texting streak. One row per conversation (i.e. per phone number
  // in `sms:+1…` form). A "day" is counted in the user's timezone at the time
  // they text — `lastActiveDate` / `lastCardDate` are YYYY-MM-DD strings in
  // that zone so day-boundary math never depends on the host's clock.
  streaks: defineTable({
    conversationId: v.string(),
    currentStreak: v.number(),
    longestStreak: v.number(),
    // Total distinct days the user has ever texted (a lifetime stat, not reset
    // when a streak breaks).
    totalDays: v.number(),
    lastActiveDate: v.string(),
    // The local date of the most recent morning card we sent, so the morning
    // loop delivers at most one card per day even across restarts.
    lastCardDate: v.optional(v.string()),
    timezone: v.string(),
    updatedAt: v.number(),
  }).index("by_conversation", ["conversationId"]),

  dailyPlans: defineTable({
    conversationId: v.string(),
    localDate: v.string(),
    timezone: v.string(),
    status: v.union(
      v.literal("planned"),
      v.literal("in_progress"),
      v.literal("reviewed"),
      v.literal("missed"),
    ),
    journal: v.optional(v.string()),
    energy: v.optional(v.string()),
    mood: v.optional(v.string()),
    blockers: v.optional(v.string()),
    definitionOfDone: v.optional(v.string()),
    progressNote: v.optional(v.string()),
    completedSummary: v.optional(v.string()),
    slippedSummary: v.optional(v.string()),
    lesson: v.optional(v.string()),
    tomorrowAdjustment: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    lastProgressAt: v.optional(v.number()),
    reviewedAt: v.optional(v.number()),
  })
    .index("by_conversation", ["conversationId"])
    .index("by_conversation_and_localDate", ["conversationId", "localDate"]),

  dailyObjectives: defineTable({
    planId: v.id("dailyPlans"),
    conversationId: v.string(),
    localDate: v.string(),
    text: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("started"),
      v.literal("done"),
      v.literal("slipped"),
    ),
    proof: v.optional(v.string()),
    notes: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_plan", ["planId"])
    .index("by_conversation_and_localDate", ["conversationId", "localDate"]),

  automationRuns: defineTable({
    runId: v.string(),
    automationId: v.string(),
    status: v.union(
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed"),
    ),
    result: v.optional(v.string()),
    error: v.optional(v.string()),
    agentId: v.optional(v.string()),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_automation", ["automationId"])
    .index("by_run_id", ["runId"]),

  // Weekly "mindset + person of the week." One row per conversation. The drop
  // lands at a user-chosen weekday/hour (their timezone); three mid-week
  // "insight" nudges follow, spaced across the week. A whole week's content is
  // generated in a single LLM pass from the user's recent chatlog and stored
  // here so the follow-ups fire on schedule without regenerating.
  weeklyMindset: defineTable({
    conversationId: v.string(),
    timezone: v.string(),
    status: v.union(
      // Onboarding ask has been sent; waiting for the user's preferred time.
      v.literal("awaiting_schedule"),
      v.literal("active"),
      v.literal("disabled"),
    ),
    // Preferred delivery slot: weekday 0=Sun..6=Sat and hour 0-23, in `timezone`.
    // Null until the user answers the onboarding ask.
    preferredWeekday: v.optional(v.number()),
    preferredHour: v.optional(v.number()),
    // The slot (YYYY-MM-DDTHH, user's zone) the last drop was sent for. Guards
    // against a double-drop within a week.
    lastDropSlot: v.optional(v.string()),
    // Wall-clock ms when the last drop actually went out. The 3 mid-week
    // insights fire at fixed elapsed offsets from this.
    dropSentAt: v.optional(v.number()),
    // True once a schedule is first saved so the first drop fires on the next
    // tick rather than waiting up to a week for the next weekday slot.
    firstDropPending: v.optional(v.boolean()),
    // This week's generated content as JSON:
    // { challenge, mindset, person, why, article: { name, url }, insights: [3] }.
    weekContent: v.optional(v.string()),
    // Which of the 3 mid-week insights have been delivered for lastDropSlot.
    insightsSent: v.optional(v.array(v.boolean())),
    onboardingSentAt: v.optional(v.number()),
    updatedAt: v.number(),
  }).index("by_conversation", ["conversationId"]),
});

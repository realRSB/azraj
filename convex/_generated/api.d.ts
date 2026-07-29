/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as accountability from "../accountability.js";
import type * as agents from "../agents.js";
import type * as automations from "../automations.js";
import type * as consolidation from "../consolidation.js";
import type * as conversations from "../conversations.js";
import type * as cookieImports from "../cookieImports.js";
import type * as dashboard from "../dashboard.js";
import type * as demo from "../demo.js";
import type * as demoMode from "../demoMode.js";
import type * as drafts from "../drafts.js";
import type * as expenses from "../expenses.js";
import type * as listItems from "../listItems.js";
import type * as memoryEvents from "../memoryEvents.js";
import type * as memoryRecords from "../memoryRecords.js";
import type * as messages from "../messages.js";
import type * as pendingContinuations from "../pendingContinuations.js";
import type * as publicUsers from "../publicUsers.js";
import type * as sendblueDedup from "../sendblueDedup.js";
import type * as settings from "../settings.js";
import type * as streakLogic from "../streakLogic.js";
import type * as streaks from "../streaks.js";
import type * as usageRecords from "../usageRecords.js";
import type * as weeklyMindset from "../weeklyMindset.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  accountability: typeof accountability;
  agents: typeof agents;
  automations: typeof automations;
  consolidation: typeof consolidation;
  conversations: typeof conversations;
  cookieImports: typeof cookieImports;
  dashboard: typeof dashboard;
  demo: typeof demo;
  demoMode: typeof demoMode;
  drafts: typeof drafts;
  expenses: typeof expenses;
  listItems: typeof listItems;
  memoryEvents: typeof memoryEvents;
  memoryRecords: typeof memoryRecords;
  messages: typeof messages;
  pendingContinuations: typeof pendingContinuations;
  publicUsers: typeof publicUsers;
  sendblueDedup: typeof sendblueDedup;
  settings: typeof settings;
  streakLogic: typeof streakLogic;
  streaks: typeof streaks;
  usageRecords: typeof usageRecords;
  weeklyMindset: typeof weeklyMindset;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};

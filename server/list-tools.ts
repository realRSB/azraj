import { z } from "zod";
import { api } from "../convex/_generated/api.js";
import { convex } from "./convex-client.js";
import { createClaudeMcpServer } from "./runtimes/claude.js";
import { defineRuntimeTool } from "./runtimes/tool.js";
import { runtimeText, type RuntimeTool } from "./runtimes/types.js";

const NAMESPACE = "boop-list";

function randomId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createListTools(conversationId: string): RuntimeTool[] {
  return [
    defineRuntimeTool(
      NAMESPACE,
      "add_list_item",
      `Add something to the user's running list — a plain checklist for things to remember or pick up, NOT a time-triggered reminder and NOT a durable fact about the user. Use for "add milk to my list", "note that I need to call the dentist", "put X on my list".`,
      { text: z.string().describe("The item text, in the user's own words.") },
      async (args) => {
        const itemId = randomId("item");
        await convex.mutation(api.listItems.create, {
          itemId,
          conversationId,
          text: args.text,
        });
        return runtimeText(`Added [${itemId}] "${args.text}" to the list.`);
      },
    ),

    defineRuntimeTool(
      NAMESPACE,
      "list_items",
      "List the user's running list. Use when they ask 'what's on my list' or 'what do I still need to do'.",
      { includeDone: z.boolean().optional().default(false) },
      async (args) => {
        const rows = await convex.query(api.listItems.listForConversation, {
          conversationId,
          statusFilter: args.includeDone ? undefined : "open",
        });
        if (rows.length === 0) {
          return runtimeText(args.includeDone ? "List is empty." : "Nothing open on the list.");
        }
        const lines = rows.map((r) => `• [${r.itemId}] ${r.status === "done" ? "✓ " : ""}${r.text}`);
        return runtimeText(lines.join("\n"));
      },
    ),

    defineRuntimeTool(
      NAMESPACE,
      "complete_list_item",
      "Mark a list item done by id. If you don't know the id, call list_items first.",
      { itemId: z.string() },
      async (args) => {
        const id = await convex.mutation(api.listItems.complete, { itemId: args.itemId });
        return runtimeText(
          id ? `Marked ${args.itemId} done.` : `No open list item found with id ${args.itemId}.`,
          Boolean(id),
        );
      },
    ),

    defineRuntimeTool(
      NAMESPACE,
      "remove_list_item",
      "Delete a list item outright by id (for items added by mistake, not for things that were actually finished — use complete_list_item for those). If you don't know the id, call list_items first.",
      { itemId: z.string() },
      async (args) => {
        const id = await convex.mutation(api.listItems.remove, { itemId: args.itemId });
        return runtimeText(
          id ? `Removed ${args.itemId}.` : `No list item found with id ${args.itemId}.`,
          Boolean(id),
        );
      },
    ),
  ];
}

export function createListMcp(conversationId: string) {
  return createClaudeMcpServer(NAMESPACE, createListTools(conversationId));
}

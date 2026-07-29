import { z } from "zod";
import { api } from "../convex/_generated/api.js";
import { convex } from "./convex-client.js";
import { createClaudeMcpServer } from "./runtimes/claude.js";
import { defineRuntimeTool } from "./runtimes/tool.js";
import { runtimeText, type RuntimeTool } from "./runtimes/types.js";

const NAMESPACE = "boop-expenses";

function randomId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function formatAmount(cents: number, currency: string): string {
  const amount = (cents / 100).toFixed(2);
  return currency === "USD" ? `$${amount}` : `${amount} ${currency}`;
}

export function createExpenseTools(conversationId: string): RuntimeTool[] {
  return [
    defineRuntimeTool(
      NAMESPACE,
      "log_expense",
      `Log a personal expense the user mentions in passing, e.g. "spent $12 on lunch", "just paid $40 for gas". This is the user's own spending, NOT Azraj's AI usage cost — do not confuse this with get_usage_summary.`,
      {
        amount: z.number().positive().describe("Amount spent, in dollars (e.g. 12.5 for $12.50)."),
        currency: z
          .string()
          .optional()
          .default("USD")
          .describe('Currency code, defaults to "USD" unless the user says otherwise.'),
        category: z
          .string()
          .optional()
          .describe('Short category if obvious from context, e.g. "food", "gas", "groceries". Omit if unclear.'),
        note: z.string().optional().describe("Any extra detail the user gave, in their own words."),
      },
      async (args) => {
        const expenseId = randomId("exp");
        const amountCents = Math.round(args.amount * 100);
        await convex.mutation(api.expenses.create, {
          expenseId,
          conversationId,
          amountCents,
          currency: args.currency,
          category: args.category,
          note: args.note,
          spentAt: Date.now(),
        });
        return runtimeText(
          `Logged ${formatAmount(amountCents, args.currency)}${args.category ? ` (${args.category})` : ""}.`,
        );
      },
    ),

    defineRuntimeTool(
      NAMESPACE,
      "expense_summary",
      "Summarize the user's logged spending. Use when they ask 'how much have I spent', 'what did I spend on X this week', or similar. Totals are grouped by category; itemized recent entries are also included.",
      {
        sinceDays: z
          .number()
          .int()
          .positive()
          .optional()
          .default(30)
          .describe("How many days back to include, defaults to 30."),
      },
      async (args) => {
        const sinceMs = Date.now() - args.sinceDays * 24 * 60 * 60 * 1000;
        const rows = await convex.query(api.expenses.listForConversation, {
          conversationId,
          sinceMs,
        });
        if (rows.length === 0) {
          return runtimeText(`No expenses logged in the last ${args.sinceDays} days.`);
        }
        const currency = rows[0]?.currency ?? "USD";
        const totalCents = rows.reduce((sum, r) => sum + r.amountCents, 0);
        const byCategory = new Map<string, number>();
        for (const r of rows) {
          const key = r.category ?? "uncategorized";
          byCategory.set(key, (byCategory.get(key) ?? 0) + r.amountCents);
        }
        const categoryLines = [...byCategory.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([cat, cents]) => `  ${cat}: ${formatAmount(cents, currency)}`);
        const recentLines = rows
          .slice(0, 20)
          .map(
            (r) =>
              `• ${formatAmount(r.amountCents, r.currency)}${r.category ? ` (${r.category})` : ""}${r.note ? ` — ${r.note}` : ""}`,
          );
        return runtimeText(
          [
            `Total last ${args.sinceDays} days: ${formatAmount(totalCents, currency)} across ${rows.length} entries.`,
            "By category:",
            ...categoryLines,
            "Recent entries:",
            ...recentLines,
          ].join("\n"),
        );
      },
    ),
  ];
}

export function createExpenseMcp(conversationId: string) {
  return createClaudeMcpServer(NAMESPACE, createExpenseTools(conversationId));
}

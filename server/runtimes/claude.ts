import {
  createSdkMcpServer,
  query,
  tool,
  type McpServerConfig,
  type McpSdkServerConfigWithInstance,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { RuntimeRunRequest, RuntimeRunResult, RuntimeTool } from "./types.js";
import { aggregateUsageFromResult, EMPTY_USAGE } from "../usage.js";
import { runAnthropicApiAgent, shouldUseAnthropicApiTransport } from "./anthropic-api.js";

function toClaudePrompt(
  prompt: RuntimeRunRequest["prompt"],
): string | AsyncIterable<SDKUserMessage> {
  if (typeof prompt === "string") return prompt;
  return (async function* (): AsyncGenerator<SDKUserMessage> {
    yield {
      type: "user",
      message: {
        role: "user",
        content: prompt as SDKUserMessage["message"]["content"],
      },
      parent_tool_use_id: null,
    };
  })();
}

export function createClaudeMcpServer(
  name: string,
  tools: RuntimeTool[],
): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name,
    version: "0.1.0",
    tools: tools.map((runtimeTool) =>
      tool(
        runtimeTool.name,
        runtimeTool.description,
        runtimeTool.inputSchema,
        async (args) => {
          const result = await runtimeTool.handle(args as Record<string, unknown>);
          return {
            content: [{ type: "text" as const, text: result.text }],
          };
        },
      ),
    ),
  });
}

// Startup work the Claude Code CLI does for interactive users that a headless
// server pays for and never benefits from. All of these are telemetry, update,
// or prompt-the-human concerns — none can change what the model is asked or what
// it's allowed to do, so they're safe for execution agents as well as the
// dispatcher. Worth ~110ms of CLI startup per turn (measured: init 851ms ->
// 725ms, medians of 9).
//
// Deliberately NOT included: DISABLE_CLAUDE_MDS / BUNDLED_SKILLS /
// POLICY_SKILLS / AUTO_MEMORY. Those were measured too and made startup
// slightly *worse* than this set alone (750ms), so they'd trade real
// execution-agent capability for nothing.
const HEADLESS_CLI_ENV: Record<string, string> = {
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
  DISABLE_AUTOUPDATER: "1",
  DISABLE_TELEMETRY: "1",
  CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL: "1",
  CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY: "1",
  CLAUDE_CODE_DISABLE_CRON: "1",
  // Claude Code makes an extra LLM call at the end of every turn to build a
  // `post_turn_summary` system message — IDE status text ("starting work",
  // "review_ready"). Nothing here reads it: the loop below handles only
  // assistant/user/result and drops system messages unread. It's generated
  // AFTER the reply text is complete, so the user was waiting on a round-trip
  // whose output is discarded. A falsy value switches the classifier from an
  // LLM call to a heuristic — the message still arrives, so the stream shape is
  // unchanged, but the tail drops from 2.0-5.0s to ~25-80ms.
  CLAUDE_CODE_CLASSIFIER_SUMMARY: "false",
};

// A real env value always wins, so any of these can be switched back on from
// .env.local or Railway without a code change.
function headlessEnv(): NodeJS.ProcessEnv {
  return { ...HEADLESS_CLI_ENV, ...process.env };
}

export async function runClaudeAgent(request: RuntimeRunRequest): Promise<RuntimeRunResult> {
  if (shouldUseAnthropicApiTransport()) {
    return runAnthropicApiAgent(request);
  }

  const runtimeServers = new Map<string, RuntimeTool[]>();
  for (const runtimeTool of request.tools) {
    const list = runtimeServers.get(runtimeTool.namespace) ?? [];
    list.push(runtimeTool);
    runtimeServers.set(runtimeTool.namespace, list);
  }

  const mcpServers = {
    ...(request.claudeMcpServers ?? {}),
    ...Object.fromEntries(
      [...runtimeServers.entries()].map(([name, tools]) => [
        name,
        createClaudeMcpServer(name, tools),
      ]),
    ),
  } as Record<string, McpServerConfig>;

  let text = "";
  let lastAssistantText = "";
  let usage = { ...EMPTY_USAGE, model: request.model };

  for await (const msg of query({
    prompt: toClaudePrompt(request.prompt),
    options: {
      systemPrompt: request.systemPrompt,
      model: request.model,
      mcpServers,
      allowedTools: request.allowedTools,
      disallowedTools: request.disallowedTools,
      env: headlessEnv(),
      // The dispatcher is forbidden from touching the world directly — every
      // built-in is already in its disallowedTools list. Dropping them from the
      // base tool set means the CLI never sends those schemas to the model at
      // all, which cuts a large block of tokens off every turn and keeps the
      // tool count low enough that the CLI stops deferring schemas behind
      // ToolSearch (an extra model round-trip before each real tool call).
      // Execution agents genuinely need WebSearch/WebFetch/Bash, so they keep
      // the full preset.
      ...(request.mode === "dispatcher" ? { tools: [] } : {}),
      ...(request.mode === "execution" ? { settingSources: ["project"] as const } : {}),
      permissionMode: "bypassPermissions",
      abortController: request.abortController,
    },
  })) {
    if (msg.type === "assistant") {
      let assistantText = "";
      for (const block of msg.message.content) {
        if (block.type === "text") {
          text += block.text;
          assistantText += block.text;
          await request.onText?.(block.text);
        } else if (block.type === "tool_use") {
          await request.onToolUse?.(block.name, block.input);
        }
      }
      if (assistantText.trim()) lastAssistantText = assistantText;
    } else if (msg.type === "user") {
      for (const block of msg.message.content) {
        if (typeof block !== "string" && block.type === "tool_result") {
          const resultText = Array.isArray(block.content)
            ? block.content
                .map((c: string | { type: string; text?: string }) =>
                  typeof c === "string" ? c : c.type === "text" ? (c.text ?? "") : "",
                )
                .join("")
            : String(block.content ?? "");
          await request.onToolResult?.("tool_result", resultText);
        }
      }
    } else if (msg.type === "result") {
      usage = aggregateUsageFromResult(msg, request.model);
      await request.onUsage?.(usage);
    }
  }

  return { text: lastAssistantText || text, usage };
}

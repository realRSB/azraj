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
      env: process.env,
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

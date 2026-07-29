import type {
  RuntimeImageBlock,
  RuntimePrompt,
  RuntimeRunRequest,
  RuntimeRunResult,
  RuntimeTextBlock,
  RuntimeTool,
} from "./types.js";
import { estimateAnthropicCostUsd, EMPTY_USAGE, type UsageTotals } from "../usage.js";

type AnthropicTextBlock = { type: "text"; text: string };
type AnthropicImageBlock = RuntimeImageBlock;
type AnthropicToolUseBlock = {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
};
type AnthropicToolResultBlock = {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
};
type AnthropicContentBlock =
  | AnthropicTextBlock
  | AnthropicImageBlock
  | AnthropicToolUseBlock
  | AnthropicToolResultBlock;
type AnthropicMessage = {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
};
type AnthropicResponse = {
  model?: string;
  role: "assistant";
  content: Array<AnthropicTextBlock | AnthropicToolUseBlock>;
  stop_reason?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
};

type ToolBinding = {
  apiName: string;
  tool: RuntimeTool;
};

const MAX_TOOL_ROUNDS = 8;

function promptToContent(prompt: RuntimePrompt): string | Array<RuntimeTextBlock | RuntimeImageBlock> {
  return typeof prompt === "string" ? prompt : prompt;
}

function mcpToolName(tool: RuntimeTool) {
  return `mcp__${tool.namespace}__${tool.name}`;
}

function sanitizeToolName(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
}

function allowedByRequest(tool: RuntimeTool, request: RuntimeRunRequest) {
  if (request.allowedTools && request.allowedTools.length === 0) return false;
  if (
    request.allowedTools &&
    !request.allowedTools.includes(tool.name) &&
    !request.allowedTools.includes(mcpToolName(tool))
  ) {
    return false;
  }
  if (
    request.disallowedTools?.includes(tool.name) ||
    request.disallowedTools?.includes(mcpToolName(tool))
  ) {
    return false;
  }
  return true;
}

function bindTools(request: RuntimeRunRequest): ToolBinding[] {
  const counts = new Map<string, number>();
  for (const tool of request.tools) {
    counts.set(tool.name, (counts.get(tool.name) ?? 0) + 1);
  }

  return request.tools
    .filter((tool) => allowedByRequest(tool, request))
    .map((tool) => ({
      tool,
      apiName: sanitizeToolName(
        counts.get(tool.name) === 1 ? tool.name : `${tool.namespace}_${tool.name}`,
      ),
    }));
}

function addUsage(total: UsageTotals, next: AnthropicResponse["usage"], model: string): UsageTotals {
  const usage = {
    model,
    inputTokens: total.inputTokens + (next?.input_tokens ?? 0),
    outputTokens: total.outputTokens + (next?.output_tokens ?? 0),
    cacheReadTokens: total.cacheReadTokens + (next?.cache_read_input_tokens ?? 0),
    cacheCreationTokens: total.cacheCreationTokens + (next?.cache_creation_input_tokens ?? 0),
  };
  return {
    ...usage,
    costUsd: estimateAnthropicCostUsd(usage),
  };
}

async function callAnthropic(
  request: RuntimeRunRequest,
  messages: AnthropicMessage[],
  tools: ToolBinding[],
): Promise<AnthropicResponse> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }

  const body: Record<string, unknown> = {
    model: request.model,
    max_tokens: Number(process.env.BOOP_MAX_TOKENS ?? 800),
    messages,
  };
  // One cache breakpoint at the end of the system block covers everything
  // before it — the tool schemas and the system prompt both. Without it the
  // dispatcher's ~10k-token preamble is re-read from scratch on every request,
  // and a turn that calls tools pays that again on every round of the loop.
  // Both are byte-stable across turns, so this is a straight win on latency
  // and cost with no change to what the model is asked.
  if (request.systemPrompt) {
    body.system = [
      {
        type: "text",
        text: request.systemPrompt,
        cache_control: { type: "ephemeral" },
      },
    ];
  }
  if (tools.length > 0) {
    body.tools = tools.map(({ apiName, tool }) => ({
      name: apiName,
      description: tool.description,
      input_schema: tool.jsonSchema,
    }));
  }

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Anthropic API ${res.status}: ${text.slice(0, 700)}`);
  }
  return JSON.parse(text) as AnthropicResponse;
}

// TODO(perf): routing the DISPATCHER through this transport is the largest
// remaining latency win — a bare Claude Code subprocess query costs ~4s before
// the model does any work, which this path skips entirely (measured: ~4s floor
// vs ~1s for a direct call). Deliberately not enabled yet.
//
// Two things must be handled first:
//  1. Only the dispatcher can move. This transport forwards `RuntimeTool`s as
//     `input_schema` entries and has no MCP client and no server-side tools, so
//     an execution agent routed here loses its integrations (they arrive as
//     `claudeMcpServers`) AND its WebSearch/WebFetch. It doesn't fail loudly —
//     it just produces a sub-agent that can't reach the world. Gate on
//     `mode === "execution" || claudeMcpServers` being non-empty.
//  2. It needs ANTHROPIC_API_KEY, which moves local billing off the Claude
//     subscription and onto API credits.
export function shouldUseAnthropicApiTransport() {
  const configured = process.env.BOOP_CLAUDE_TRANSPORT?.trim().toLowerCase();
  if (configured === "api") return true;
  if (configured === "agent-sdk" || configured === "claude-code") return false;
  return Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID);
}

export async function runAnthropicApiAgent(
  request: RuntimeRunRequest,
): Promise<RuntimeRunResult> {
  const tools = bindTools(request);
  const toolByName = new Map(tools.map((binding) => [binding.apiName, binding.tool]));
  const messages: AnthropicMessage[] = [
    {
      role: "user",
      content: promptToContent(request.prompt),
    },
  ];
  let usage: UsageTotals = { ...EMPTY_USAGE, model: request.model };
  let finalText = "";

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const response = await callAnthropic(request, messages, tools);
    usage = addUsage(usage, response.usage, response.model ?? request.model);
    const content = response.content ?? [];
    const text = content
      .filter((block): block is AnthropicTextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");
    if (text) {
      finalText = text;
      await request.onText?.(text);
    }

    const toolUses = content.filter(
      (block): block is AnthropicToolUseBlock => block.type === "tool_use",
    );
    if (toolUses.length === 0) {
      return { text: finalText, usage };
    }

    messages.push({ role: "assistant", content });
    // The model emits several tool_use blocks in one turn precisely when the
    // work is independent — the dispatcher is told to fan out spawn_agent that
    // way. Running them one after another threw that away and made two
    // 20-second sub-agents take 40 seconds. Results are collected in the
    // model's original order regardless of which finishes first.
    for (const toolUse of toolUses) {
      await request.onToolUse?.(toolUse.name, toolUse.input);
    }
    const results: AnthropicToolResultBlock[] = await Promise.all(
      toolUses.map(async (toolUse): Promise<AnthropicToolResultBlock> => {
        const tool = toolByName.get(toolUse.name);
        if (!tool) {
          const error = `Tool ${toolUse.name} is not available.`;
          await request.onToolResult?.(toolUse.name, error);
          return {
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: error,
            is_error: true,
          };
        }
        try {
          const result = await tool.handle(
            typeof toolUse.input === "object" && toolUse.input !== null
              ? (toolUse.input as Record<string, unknown>)
              : {},
          );
          await request.onToolResult?.(toolUse.name, result.text);
          return {
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: result.text,
            is_error: result.success === false,
          };
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          await request.onToolResult?.(toolUse.name, error);
          return {
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: error,
            is_error: true,
          };
        }
      }),
    );
    messages.push({ role: "user", content: results });
  }

  return {
    text: finalText || "I got stuck looping on tools. Try that again with one clear next action.",
    usage,
  };
}

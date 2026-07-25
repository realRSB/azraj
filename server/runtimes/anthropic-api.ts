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
    system: request.systemPrompt,
    messages,
  };
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
    const results: AnthropicToolResultBlock[] = [];
    for (const toolUse of toolUses) {
      const tool = toolByName.get(toolUse.name);
      await request.onToolUse?.(toolUse.name, toolUse.input);
      if (!tool) {
        const error = `Tool ${toolUse.name} is not available.`;
        await request.onToolResult?.(toolUse.name, error);
        results.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: error,
          is_error: true,
        });
        continue;
      }
      try {
        const result = await tool.handle(
          typeof toolUse.input === "object" && toolUse.input !== null
            ? (toolUse.input as Record<string, unknown>)
            : {},
        );
        await request.onToolResult?.(toolUse.name, result.text);
        results.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: result.text,
          is_error: result.success === false,
        });
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        await request.onToolResult?.(toolUse.name, error);
        results.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: error,
          is_error: true,
        });
      }
    }
    messages.push({ role: "user", content: results });
  }

  return {
    text: finalText || "I got stuck looping on tools. Try that again with one clear next action.",
    usage,
  };
}

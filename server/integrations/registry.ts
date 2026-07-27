import type { McpSdkServerConfigWithInstance } from "@anthropic-ai/claude-agent-sdk";
import type { RuntimeTool } from "../runtimes/types.js";

export interface IntegrationModule {
  name: string;
  description: string;
  requiredEnv?: string[];
  isEnabled?: () => Promise<boolean>;
  createServer: (ctx: IntegrationContext) => Promise<McpSdkServerConfigWithInstance>;
  createTools?: (ctx: IntegrationContext) => Promise<RuntimeTool[]>;
}

export interface IntegrationContext {
  conversationId?: string;
  agentId?: string;
  composioUserId?: string;
}

const registry = new Map<string, IntegrationModule>();

export function registerIntegration(mod: IntegrationModule): void {
  registry.set(mod.name, mod);
}

export function listIntegrations(): IntegrationModule[] {
  return [...registry.values()];
}

export async function listEnabledIntegrations(
  composioUserId?: string,
): Promise<IntegrationModule[]> {
  const out: IntegrationModule[] = [];
  const names = new Set<string>();
  if (!composioUserId) {
    for (const mod of registry.values()) {
      try {
        if (!mod.isEnabled || (await mod.isEnabled())) {
          out.push(mod);
          names.add(mod.name);
        }
      } catch (err) {
        console.warn(`[integrations] failed to check ${mod.name} enabled state`, err);
      }
    }
  }
  if (composioUserId) {
    try {
      const { buildComposioIntegrationModule, getComposio, listConnectedToolkitsForUser } =
        await import("../composio.js");
      if (getComposio()) {
        const connected = await listConnectedToolkitsForUser(composioUserId);
        for (const conn of connected) {
          if (conn.status !== "ACTIVE" || names.has(conn.slug)) continue;
          const mod = buildComposioIntegrationModule(conn.slug);
          out.push(mod);
          names.add(mod.name);
        }
      }
    } catch (err) {
      console.warn("[integrations] failed to load user Composio connections", err);
    }
  }
  return out;
}

export function getIntegration(name: string): IntegrationModule | undefined {
  return registry.get(name);
}

export async function loadIntegrations(): Promise<void> {
  const { registerComposioToolkits } = await import("./composio-loader.js");
  await registerComposioToolkits();
  const { registerBrowserIntegration } = await import("./browser-loader.js");
  registerBrowserIntegration();
  const { registerAppleIntegration } = await import("./apple-loader.js");
  registerAppleIntegration();
  const loaded = [...registry.keys()];
  const enabled = (await listEnabledIntegrations()).map((i) => i.name);
  console.log(
    `[integrations] loaded: ${loaded.join(", ") || "(none — connect a toolkit from the Debug UI's Connections tab)"}; enabled: ${enabled.join(", ") || "(none)"}`,
  );
}

export async function refreshIntegrations(): Promise<void> {
  registry.clear();
  await loadIntegrations();
}

export function makeContext(
  conversationId?: string,
  agentId?: string,
  composioUserId?: string,
): IntegrationContext {
  return { conversationId, agentId, composioUserId };
}

async function resolveIntegration(name: string): Promise<IntegrationModule | undefined> {
  const registered = registry.get(name);
  if (registered) return registered;
  try {
    const { buildComposioIntegrationModule, getComposio } = await import("../composio.js");
    if (getComposio()) return buildComposioIntegrationModule(name);
  } catch (err) {
    console.warn(`[integrations] failed dynamic Composio lookup for ${name}`, err);
  }
  return undefined;
}

export async function buildMcpServersForIntegrations(
  names: string[],
  conversationId?: string,
  agentId?: string,
  composioUserId?: string,
): Promise<Record<string, McpSdkServerConfigWithInstance>> {
  const ctx = makeContext(conversationId, agentId, composioUserId);
  const out: Record<string, McpSdkServerConfigWithInstance> = {};
  for (const name of names) {
    const mod = await resolveIntegration(name);
    if (!mod) {
      console.warn(`[integrations] unknown integration: ${name}`);
      continue;
    }
    if (mod.isEnabled && !(await mod.isEnabled())) {
      console.warn(`[integrations] skipped disabled integration: ${name}`);
      continue;
    }
    try {
      out[name] = await mod.createServer(ctx);
    } catch (err) {
      console.error(`[integrations] failed to build ${name}`, err);
    }
  }
  return out;
}

export async function buildRuntimeToolsForIntegrations(
  names: string[],
  conversationId?: string,
  composioUserId?: string,
): Promise<RuntimeTool[]> {
  const ctx = makeContext(conversationId, undefined, composioUserId);
  const out: RuntimeTool[] = [];
  for (const name of names) {
    const mod = await resolveIntegration(name);
    if (!mod) {
      console.warn(`[integrations] unknown integration: ${name}`);
      continue;
    }
    if (!mod.createTools) {
      console.warn(`[integrations] ${name} does not expose runtime tools`);
      continue;
    }
    if (mod.isEnabled && !(await mod.isEnabled())) {
      console.warn(`[integrations] skipped disabled integration: ${name}`);
      continue;
    }
    try {
      out.push(...(await mod.createTools(ctx)));
    } catch (err) {
      console.error(`[integrations] failed to build runtime tools for ${name}`, err);
    }
  }
  return out;
}

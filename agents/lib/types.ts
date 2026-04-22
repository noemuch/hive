export type AgentRole = "pm" | "designer" | "developer" | "qa" | "ops" | "generalist";

export type ArtifactType = "ticket" | "spec" | "decision" | "component" | "pr" | "document";

export type AgentPersonality = {
  name: string;
  role: AgentRole;
  brief: string;
  systemPrompt: string;
  triggers: string[];
  artifactTypes: ArtifactType[];
};

/**
 * Configuration for a bureau's agents. Consumed by the launcher — each
 * entry is spawned as a separate process at boot time.
 *
 * Canonical name: `BureauConfig`. `TeamConfig` is kept as a type alias for
 * 90 days so existing `agents/teams/*.ts` files keep compiling without
 * touch-ups; delete the alias when all known callers have migrated.
 */
export type BureauConfig = {
  agents: AgentPersonality[];
};
/** @deprecated use BureauConfig — kept for 90-day backward compat */
export type TeamConfig = BureauConfig;

/**
 * Configuration for a single MCP (Model Context Protocol) server an agent is
 * wired to at boot time. Consumed by `mcp-client.ts` / `tool-loop.ts` via the
 * `AGENT_TOOLS` env var (JSON array of ToolConfig). See #217.
 */
export type ToolConfig = {
  name: string;
  endpoint: string;
  apiKey?: string;
  timeoutMs?: number;
};

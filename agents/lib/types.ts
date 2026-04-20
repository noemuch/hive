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

export type TeamConfig = {
  agents: AgentPersonality[];
};

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

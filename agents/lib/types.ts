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

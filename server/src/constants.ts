export const VALID_ROLES = ["pm", "designer", "developer", "qa", "ops", "generalist"] as const;
export type AgentRole = typeof VALID_ROLES[number];

export const TIER_LIMITS: Record<string, number> = {
  free: 3,
  verified: 10,
  trusted: Infinity,
};

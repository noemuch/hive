/**
 * Team config template — copy this file and customize for your agents.
 *
 * Usage:
 *   1. Copy: cp agents/teams/_template.ts agents/teams/yourcompany.ts
 *   2. Define your agents (name, role, personality, triggers, artifact types)
 *   3. Register on Hive: go to http://localhost:3000/register
 *   4. Launch: HIVE_EMAIL=you@example.com HIVE_PASSWORD=*** ANTHROPIC_API_KEY=sk-ant-*** bun run agents -- --team yourcompany
 */

import type { TeamConfig } from "../lib/types";

const team: TeamConfig = {
  agents: [
    {
      name: "YourAgent",
      role: "developer",
      brief: "Short description shown in Hive UI",
      systemPrompt: "You are YourAgent, a backend developer at a startup. You write clean, pragmatic code and prefer simple solutions. Keep messages under 3 sentences.",
      triggers: ["api", "database", "backend", "deploy"],
      artifactTypes: ["spec", "pr", "component"],
    },
    // Add more agents here...
  ],
};

export default team;

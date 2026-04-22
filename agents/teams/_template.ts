/**
 * Bureau config template — copy this file and customize for your agents.
 *
 * Usage:
 *   1. Copy: cp agents/teams/_template.ts agents/teams/yourbureau.ts
 *   2. Define your agents (name, role, personality, triggers, artifact types)
 *   3. Register on Hive: go to http://localhost:3000/register
 *   4. Launch with the LLM provider of your choice (any OpenAI-compatible API):
 *
 *      # Anthropic (via OpenAI-compat endpoint)
 *      HIVE_EMAIL=you@example.com HIVE_PASSWORD=*** \
 *      LLM_API_KEY=sk-ant-*** \
 *      LLM_BASE_URL=https://api.anthropic.com/v1/openai \
 *      LLM_MODEL=claude-haiku-4-5-20251001 \
 *      bun run agents -- --bureau yourbureau
 *
 *      # Mistral La Plateforme (cheapest sweet spot for chat agents)
 *      LLM_API_KEY=mistral-*** \
 *      LLM_BASE_URL=https://api.mistral.ai/v1 \
 *      LLM_MODEL=mistral-small-latest \
 *      bun run agents -- --bureau yourbureau
 *
 *      # DeepSeek (great quality/price ratio; off-peak −50%)
 *      LLM_API_KEY=sk-*** \
 *      LLM_BASE_URL=https://api.deepseek.com/v1 \
 *      LLM_MODEL=deepseek-chat \
 *      bun run agents -- --bureau yourbureau
 *
 *      # Local Ollama (free, self-hosted)
 *      LLM_API_KEY=ollama \
 *      LLM_BASE_URL=http://localhost:11434/v1 \
 *      LLM_MODEL=llama3.3:70b \
 *      bun run agents -- --bureau yourbureau
 *
 *   See docs/BYOK.md for the full provider list and trade-offs.
 *
 *   Backward-compat: ANTHROPIC_API_KEY is accepted as an alias for LLM_API_KEY.
 *   CLI flag: --bureau is canonical; --team remains a deprecated alias for 90
 *   days (prints a warning when used).
 */

import type { BureauConfig } from "../lib/types";

const bureau: BureauConfig = {
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

export default bureau;

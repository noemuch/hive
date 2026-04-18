-- 027: Add llm_provider column on agents.
--
-- Declarative label of which LLM powers the agent (anthropic / mistral /
-- deepseek / openai / gemini / groq / cerebras / self-hosted / other).
-- Free-form text so adding a new provider doesn't require a migration.
-- Nullable: existing agents have no declared provider; new registrations
-- populate it from the optional `llm_provider` field on /api/agents/register.
--
-- Motivation: Hive is a cross-LLM agent platform — the leaderboard and
-- agent profile display this so visitors see which models are being
-- compared head-to-head. See docs/BYOK.md for the provider catalog.

ALTER TABLE agents ADD COLUMN llm_provider text;

-- Partial index: most agents are active, and we only query this column for
-- filter/aggregate use cases where NULL is not meaningful.
CREATE INDEX idx_agents_llm_provider
  ON agents (llm_provider)
  WHERE llm_provider IS NOT NULL;

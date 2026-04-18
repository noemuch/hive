-- One-shot: backfill agents.llm_provider for the demo teams.
--
-- Run this after you've switched the 4 demo teams (lyse, vantage, meridian,
-- helix) to Mistral (or whichever provider you pick). This updates the
-- column so the "powered by X" badge shows on profile + leaderboard for
-- existing agents.
--
-- Usage:
--   psql $DATABASE_URL -f scripts/backfill-demo-llm-provider.sql
--
-- To target a different provider, change the value in the UPDATE below.
-- Agent names verified against agents/teams/*.ts as of 2026-04-18.

BEGIN;

UPDATE agents
SET llm_provider = 'mistral'
WHERE llm_provider IS NULL
  AND name IN (
    -- Lyse (4 agents)
    'Nova', 'Arke', 'Iris', 'Orion',
    -- Vantage (7 agents)
    'Kai', 'Sable', 'Cleo', 'Rune', 'Pike', 'Wren', 'Sage',
    -- Meridian (7 agents)
    'Muse', 'Lux', 'Ember', 'Dash', 'Echo', 'Fern', 'Sol',
    -- Helix (7 agents)
    'Vega', 'Flux', 'Prism', 'Atlas', 'Cipher', 'Lyra', 'Bolt'
  );

-- Report what changed.
SELECT llm_provider, COUNT(*) AS agents
FROM agents
WHERE status <> 'retired'
GROUP BY llm_provider
ORDER BY llm_provider NULLS LAST;

COMMIT;

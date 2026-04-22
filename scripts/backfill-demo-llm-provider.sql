-- One-shot: backfill agents.llm_provider for a set of agents whose provider
-- column is NULL (e.g. registered before the `llm_provider` column existed,
-- or re-pointed at a new provider without restarting the registration flow).
--
-- This SQL runs AGAINST THE POST-MIGRATION-038 SCHEMA (table is `bureaux`,
-- FK column on agents is `bureau_id`). The script itself only touches the
-- `agents` table so the rename is irrelevant for the UPDATE — documenting
-- here so future editors don't have to re-derive it.
--
-- The demo teams (`lyse`, `vantage`, `meridian`, `helix`) that once populated
-- the hardcoded name list have been retired. The list below is intentionally
-- empty — edit it to match whichever bureau(x) you need to backfill before
-- running.
--
-- Usage:
--   psql $DATABASE_URL -f scripts/backfill-demo-llm-provider.sql
--
-- To target a different provider, change the value in the UPDATE below.

BEGIN;

-- EDIT ME: add the agent names to backfill inside the IN (...) list below,
-- then uncomment the UPDATE. Left commented-out so an accidental run
-- against production is a no-op.
--
-- UPDATE agents
-- SET llm_provider = 'mistral'
-- WHERE llm_provider IS NULL
--   AND name IN (
--     -- e.g. 'Atlas', 'Nova', ...
--   );

-- Report current provider distribution (non-retired agents only).
SELECT llm_provider, COUNT(*) AS agents
FROM agents
WHERE status <> 'retired'
GROUP BY llm_provider
ORDER BY llm_provider NULLS LAST;

COMMIT;

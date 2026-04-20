-- Phase 6 — Mode B (API hire): agent_hires + agent_hire_calls
-- Issue #220 / Epic #184
--
-- Stores synchronous HTTP hire tokens (builder pays per invocation) and per-call
-- telemetry. The calls table is partitioned monthly like messages / event_log.
--
-- pgcrypto is already enabled in 001_init.sql (used for gen_random_uuid()).

CREATE TABLE IF NOT EXISTS agent_hires (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id),
  hiring_builder_id UUID NOT NULL REFERENCES builders(id),
  hire_token_hash TEXT NOT NULL,
  hire_token_prefix TEXT NOT NULL,
  llm_api_key_encrypted TEXT,
  llm_base_url TEXT,
  llm_model TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  calls_count INT NOT NULL DEFAULT 0,
  last_called_at TIMESTAMPTZ
);

COMMENT ON COLUMN agent_hires.hire_token_prefix IS
  'First 8 chars of hire token plaintext for O(1) lookup; full token verified via bcrypt against hire_token_hash (mirrors api_key pattern — see 002_api_key_prefix.sql).';
COMMENT ON COLUMN agent_hires.llm_api_key_encrypted IS
  'Ciphertext only — MUST be encrypted at the application layer (libsodium / pgcrypto sym_encrypt) before insert. Never store plaintext. Decryption happens server-side at invocation time — see #223.';

CREATE INDEX IF NOT EXISTS idx_agent_hires_token_prefix ON agent_hires(hire_token_prefix);
CREATE INDEX IF NOT EXISTS idx_agent_hires_agent ON agent_hires(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_hires_builder ON agent_hires(hiring_builder_id);

-- Per-call telemetry, partitioned by month on called_at
CREATE TABLE IF NOT EXISTS agent_hire_calls (
  id BIGSERIAL,
  hire_id UUID NOT NULL REFERENCES agent_hires(id),
  request_size INT,
  response_size INT,
  latency_ms INT,
  llm_cost_estimate NUMERIC(10,6),
  status TEXT,
  called_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id, called_at)
) PARTITION BY RANGE (called_at);

CREATE INDEX IF NOT EXISTS idx_agent_hire_calls_hire_time
  ON agent_hire_calls(hire_id, called_at DESC);

-- Create current + next month partitions (mirrors messages / event_log in 001_init.sql)
DO $$
DECLARE
  current_start DATE := date_trunc('month', CURRENT_DATE);
  current_end DATE := date_trunc('month', CURRENT_DATE + INTERVAL '1 month');
  next_end DATE := date_trunc('month', CURRENT_DATE + INTERVAL '2 months');
  current_name TEXT := 'agent_hire_calls_' || to_char(CURRENT_DATE, 'YYYY_MM');
  next_name TEXT := 'agent_hire_calls_' || to_char(CURRENT_DATE + INTERVAL '1 month', 'YYYY_MM');
BEGIN
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS %I PARTITION OF agent_hire_calls FOR VALUES FROM (%L) TO (%L)',
    current_name, current_start, current_end
  );
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS %I PARTITION OF agent_hire_calls FOR VALUES FROM (%L) TO (%L)',
    next_name, current_end, next_end
  );
END $$;

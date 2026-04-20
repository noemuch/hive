-- Phase 6 economic inversion (#229): builder earnings + credit ledger.
-- Idempotent. Forward-compatible with #220 (agent_hires / agent_hire_calls):
-- the ALTER on agent_hire_calls runs only when that table exists, so this
-- migration lands cleanly whether or not #220 has shipped yet.

-- Monthly earnings rollup (one row per builder per month).
CREATE TABLE IF NOT EXISTS builder_earnings (
  builder_id uuid NOT NULL REFERENCES builders(id) ON DELETE CASCADE,
  month date NOT NULL,
  hire_revenue_cents bigint NOT NULL DEFAULT 0,
  hive_fee_cents bigint NOT NULL DEFAULT 0,
  net_cents bigint NOT NULL DEFAULT 0,
  agent_count int NOT NULL DEFAULT 0,
  hire_count int NOT NULL DEFAULT 0,
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (builder_id, month)
);

CREATE INDEX IF NOT EXISTS idx_builder_earnings_month
  ON builder_earnings(month DESC);

-- Credit ledger (future subscription / prepaid model).
CREATE TABLE IF NOT EXISTS builder_credits (
  builder_id uuid PRIMARY KEY REFERENCES builders(id) ON DELETE CASCADE,
  balance_cents bigint NOT NULL DEFAULT 0,
  lifetime_earned_cents bigint NOT NULL DEFAULT 0,
  lifetime_spent_cents bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Payout scaffolding (Stripe placeholder — populated in a separate issue).
CREATE TABLE IF NOT EXISTS builder_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  builder_id uuid NOT NULL REFERENCES builders(id) ON DELETE CASCADE,
  amount_cents bigint NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'processing', 'paid', 'failed')),
  stripe_payout_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_builder_payouts_builder
  ON builder_payouts(builder_id, created_at DESC);

-- Per-call earnings annotations on agent_hire_calls. Deferred until #220 ships
-- the table — this block is a no-op on fresh DBs without agent_hire_calls yet.
-- When #220 lands, re-running this migration via _migrations idempotency on
-- `ADD COLUMN IF NOT EXISTS` plus the IF-EXISTS guard means we never error.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_tables
    WHERE tablename = 'agent_hire_calls'
  ) THEN
    ALTER TABLE agent_hire_calls
      ADD COLUMN IF NOT EXISTS revenue_cents bigint,
      ADD COLUMN IF NOT EXISTS hive_fee_cents bigint,
      ADD COLUMN IF NOT EXISTS builder_earning_cents bigint,
      ADD COLUMN IF NOT EXISTS settled_at timestamptz;

    -- Index only the unsettled calls — keeps the rollup scan cheap.
    IF NOT EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE tablename = 'agent_hire_calls'
        AND indexname  = 'idx_agent_hire_calls_unsettled'
    ) THEN
      CREATE INDEX idx_agent_hire_calls_unsettled
        ON agent_hire_calls(called_at)
        WHERE settled_at IS NULL;
    END IF;
  END IF;
END$$;

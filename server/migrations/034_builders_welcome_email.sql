-- 030: Track welcome email send time for idempotency (#205).
--
-- Nullable column: NULL = email not yet sent (or pre-migration builders whose
-- welcome send was never attempted). Natural idempotency already exists because
-- the register endpoint returns 409 on duplicate email before ever reaching the
-- email path — this column is a belt-and-suspenders guard against double-sends
-- from handler retries or manual re-invocation.

ALTER TABLE builders
  ADD COLUMN IF NOT EXISTS welcome_email_sent_at TIMESTAMPTZ;

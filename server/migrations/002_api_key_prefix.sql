-- Add api_key_prefix column for O(1) lookup instead of O(n) bcrypt scan
ALTER TABLE agents ADD COLUMN IF NOT EXISTS api_key_prefix TEXT;
CREATE INDEX IF NOT EXISTS idx_agents_api_key_prefix ON agents(api_key_prefix) WHERE status != 'retired';

-- Backfill: existing agents won't have a prefix, so they'll need re-registration
-- or we can leave them (they'll fail auth until key is rotated)

-- 020: Change agent name uniqueness from global to per-builder.
-- Currently: name TEXT UNIQUE NOT NULL (global — two builders can't have agents with same name)
-- After:  UNIQUE(builder_id, name) — names unique within a builder, not globally.

-- Drop the old global unique constraint
ALTER TABLE agents DROP CONSTRAINT IF EXISTS agents_name_key;

-- Add per-builder unique constraint
CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_builder_name ON agents(builder_id, name);

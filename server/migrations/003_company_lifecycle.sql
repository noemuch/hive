-- M3: Company lifecycle columns + seed 3 additional companies

-- Add lifecycle columns to companies
ALTER TABLE companies ADD COLUMN IF NOT EXISTS agent_count_cache INT DEFAULT 0;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ DEFAULT now();

-- Rename status → lifecycle_state for clarity (idempotent)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'companies' AND column_name = 'status'
  ) THEN
    ALTER TABLE companies RENAME COLUMN status TO lifecycle_state;
  END IF;
END $$;

-- New companies should default to 'forming'
ALTER TABLE companies ALTER COLUMN lifecycle_state SET DEFAULT 'forming';

-- Update agent_count_cache for existing companies
UPDATE companies SET agent_count_cache = (
  SELECT COUNT(*)::int FROM agents
  WHERE agents.company_id = companies.id
  AND agents.status NOT IN ('retired', 'disconnected')
);

-- Seed 3 new companies
INSERT INTO companies (name, description, lifecycle_state, floor_plan) VALUES
  ('Nexus', 'AI-native consulting firm specializing in workflow automation', 'active', 'startup-6'),
  ('Forgepoint', 'Engineering collective building open-source developer tools', 'active', 'startup-8'),
  ('Solara', 'Product studio focused on sustainable tech and green UX', 'forming', 'startup-2')
ON CONFLICT (name) DO NOTHING;

-- Create default channels for the 3 new companies
INSERT INTO channels (company_id, name, type)
SELECT c.id, ch.name, ch.type
FROM companies c
CROSS JOIN (VALUES
  ('#general', 'discussion'),
  ('#work', 'work'),
  ('#decisions', 'decisions')
) AS ch(name, type)
WHERE c.name IN ('Nexus', 'Forgepoint', 'Solara')
ON CONFLICT DO NOTHING;

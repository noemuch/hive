-- M3: #public channel + builder tiers + builder profile columns

-- Allow channels without a company (for #public)
ALTER TABLE channels ALTER COLUMN company_id DROP NOT NULL;

-- Seed global #public channel (idempotent)
INSERT INTO channels (company_id, name, type) VALUES (NULL, '#public', 'discussion')
ON CONFLICT DO NOTHING;

-- Builder tiers
ALTER TABLE builders ADD COLUMN IF NOT EXISTS tier TEXT DEFAULT 'free' CHECK (tier IN ('free', 'verified', 'trusted'));
ALTER TABLE builders ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT false;

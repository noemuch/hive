-- Add social links to builder profiles
ALTER TABLE builders ADD COLUMN IF NOT EXISTS socials JSONB DEFAULT '{}';
-- Expected structure: { "github": "username", "twitter": "handle", "linkedin": "url", "website": "url" }

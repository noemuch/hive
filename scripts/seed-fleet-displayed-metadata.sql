-- seed-fleet-displayed-metadata.sql
--
-- Seeds displayed_skills, displayed_tools, displayed_specializations,
-- displayed_languages, displayed_memory_type, and backdated_joined_at
-- for all fleet seed agents.
--
-- Usage:
--   psql $DATABASE_URL -f scripts/seed-fleet-displayed-metadata.sql
--
-- Idempotent:  only updates agents where displayed_skills = '[]' (default).
--              Re-running is a safe no-op once populated.
-- Scoped:      fleet builders only — email LIKE 'noe+%@finary.com'.
-- Non-destructive: llm_provider is NOT touched (fleet stays on Mistral Nemo).
--
-- Requires: migration 028 (displayed_* columns + backdated_joined_at).

BEGIN;

WITH

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Role → pool definitions
--    Roles match the DB CHECK constraint: pm | designer | developer | qa | ops | generalist
-- ─────────────────────────────────────────────────────────────────────────────
role_pools(role_key, skills_pool, tools_pool, specs_pool) AS (
  VALUES

  ( 'developer',
    ARRAY[
      'refactor-typescript-codebase', 'write-unit-test-suite', 'design-rest-api',
      'code-review-detailed', 'optimize-postgres-queries', 'setup-ci-pipeline',
      'debug-memory-leaks', 'migrate-database-schemas', 'implement-oauth2-flow',
      'write-integration-tests', 'build-docker-images', 'profile-bundle-size',
      'audit-security-headers', 'configure-observability'
    ]::text[],
    ARRAY[
      'web_search', 'file_read', 'code_lint', 'git_diff', 'run_tests',
      'read_url', 'summarize_text', 'grep_codebase', 'build_project', 'deploy_preview'
    ]::text[],
    ARRAY[
      'TypeScript / Node.js', 'Go microservices', 'Rust systems programming',
      'Python backend', 'PostgreSQL optimization', 'React + Next.js',
      'DevOps automation', 'API design (REST, GraphQL)',
      'Accessibility engineering', 'Performance tuning'
    ]::text[]
  ),

  ( 'qa',
    ARRAY[
      'write-unit-test-suite', 'write-integration-tests', 'code-review-detailed',
      'debug-memory-leaks', 'audit-security-headers', 'setup-ci-pipeline',
      'profile-bundle-size', 'configure-observability', 'design-rest-api',
      'refactor-typescript-codebase'
    ]::text[],
    ARRAY[
      'run_tests', 'file_read', 'code_lint', 'git_diff', 'web_search',
      'read_url', 'grep_codebase', 'build_project', 'summarize_text', 'deploy_preview'
    ]::text[],
    ARRAY[
      'TypeScript / Node.js', 'Python backend', 'PostgreSQL optimization',
      'API design (REST, GraphQL)', 'Accessibility engineering',
      'Performance tuning', 'DevOps automation', 'React + Next.js'
    ]::text[]
  ),

  ( 'designer',
    ARRAY[
      'design-mobile-onboarding', 'audit-accessibility', 'create-design-system-tokens',
      'wireframe-feature-flow', 'design-empty-states', 'write-microcopy',
      'run-usability-test', 'build-figma-component-library',
      'translate-brand-identity', 'design-responsive-layout'
    ]::text[],
    ARRAY[
      'read_url', 'summarize_text', 'web_search', 'image_generate',
      'color_contrast_check', 'figma_read', 'copy_critique', 'a11y_audit'
    ]::text[],
    ARRAY[
      'Product design (B2B SaaS)', 'Design systems', 'Brand identity',
      'Illustration & iconography', 'Motion & micro-interactions',
      'UX research', 'Mobile-first design', 'Accessibility (WCAG)'
    ]::text[]
  ),

  ( 'pm',
    ARRAY[
      'write-prd-feature-spec', 'prioritize-backlog-rice', 'define-north-star-metric',
      'synthesize-user-interviews', 'write-release-notes', 'run-customer-discovery',
      'align-stakeholders-async', 'decompose-epic-into-stories',
      'write-postmortem', 'map-customer-journey'
    ]::text[],
    ARRAY[
      'web_search', 'read_url', 'summarize_text',
      'survey_build', 'analytics_query', 'interview_transcribe'
    ]::text[],
    ARRAY[
      'B2B SaaS product', 'Growth & retention', 'Platform / API products',
      'Enterprise sales enablement', 'Product analytics',
      'OKR facilitation', 'Technical PM', 'Customer success'
    ]::text[]
  ),

  ( 'generalist',
    ARRAY[
      'write-blog-post-seo', 'edit-long-form-copy', 'draft-launch-announcement',
      'translate-en-fr', 'write-technical-tutorial', 'summarize-research-paper',
      'craft-social-thread', 'proofread-critical-copy',
      'draft-email-cadence', 'write-case-study'
    ]::text[],
    ARRAY[
      'read_url', 'web_search', 'summarize_text', 'grammar_check', 'seo_audit'
    ]::text[],
    ARRAY[
      'Technical writing', 'Launch comms', 'SEO & long-form',
      'Developer marketing', 'Narrative design', 'Ghostwriting',
      'Editing & proofreading', 'Localization (FR/ES)'
    ]::text[]
  ),

  ( 'ops',
    ARRAY[
      'source-candidates-linkedin', 'draft-sales-sequence', 'qualify-inbound-lead',
      'close-q1-books', 'review-vendor-contract', 'draft-npd-process',
      'run-weekly-all-hands', 'build-hiring-pipeline'
    ]::text[],
    ARRAY[
      'web_search', 'read_url', 'summarize_text', 'crm_query', 'calendar_schedule'
    ]::text[],
    ARRAY[
      'Recruiting & sourcing', 'B2B sales', 'Revenue operations',
      'Contract review', 'Compliance & privacy', 'People operations'
    ]::text[]
  )
),

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Fleet agents eligible for seeding
--    Idempotency: skip agents where displayed_skills is already populated.
-- ─────────────────────────────────────────────────────────────────────────────
fleet_agents AS (
  SELECT a.id, a.role AS role_key
  FROM   agents a
  JOIN   builders b ON b.id = a.builder_id
  WHERE  b.email LIKE 'noe+%@finary.com'
    AND  a.displayed_skills = '[]'::jsonb
),

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Per-agent random counts (materialized once per agent)
--    Each random() call here produces one value used later as a constant.
-- ─────────────────────────────────────────────────────────────────────────────
counts AS (
  SELECT
    fa.id,
    fa.role_key,
    3 + floor(random() * 3)::int  AS n_skills,       -- 3-5
    3 + floor(random() * 3)::int  AS n_tools,        -- 3-5
    2 + floor(random() * 2)::int  AS n_specs,        -- 2-3
    floor(random() * 3)::int      AS n_extra_langs,  -- 0-2
    random()                      AS mem_r,           -- for weighted memory type
    1 + floor(random() * 90)::int AS backdate_days   -- 1-90
  FROM fleet_agents fa
),

-- ─────────────────────────────────────────────────────────────────────────────
-- 4a. Skills: shuffle role pool, slice first n_skills
-- ─────────────────────────────────────────────────────────────────────────────
agent_skills AS (
  SELECT
    c.id,
    (array_agg(skill ORDER BY random()))[1:c.n_skills] AS skills
  FROM   counts c
  JOIN   role_pools rp ON rp.role_key = c.role_key
  CROSS JOIN LATERAL unnest(rp.skills_pool) AS skill
  GROUP  BY c.id, c.n_skills
),

-- ─────────────────────────────────────────────────────────────────────────────
-- 4b. Tools: shuffle role pool, slice first n_tools
-- ─────────────────────────────────────────────────────────────────────────────
agent_tools AS (
  SELECT
    c.id,
    (array_agg(tool ORDER BY random()))[1:c.n_tools] AS tools
  FROM   counts c
  JOIN   role_pools rp ON rp.role_key = c.role_key
  CROSS JOIN LATERAL unnest(rp.tools_pool) AS tool
  GROUP  BY c.id, c.n_tools
),

-- ─────────────────────────────────────────────────────────────────────────────
-- 4c. Specializations: shuffle role pool, slice first n_specs
-- ─────────────────────────────────────────────────────────────────────────────
agent_specs AS (
  SELECT
    c.id,
    (array_agg(spec ORDER BY random()))[1:c.n_specs] AS specs
  FROM   counts c
  JOIN   role_pools rp ON rp.role_key = c.role_key
  CROSS JOIN LATERAL unnest(rp.specs_pool) AS spec
  GROUP  BY c.id, c.n_specs
),

-- ─────────────────────────────────────────────────────────────────────────────
-- 4d. Languages: English always + 0-2 extras from the language pool
-- ─────────────────────────────────────────────────────────────────────────────
agent_langs AS (
  SELECT
    c.id,
    ARRAY['English'] || CASE c.n_extra_langs
      WHEN 0 THEN ARRAY[]::text[]
      ELSE        (array_agg(lang ORDER BY random()))[1:c.n_extra_langs]
    END AS langs
  FROM   counts c
  CROSS JOIN LATERAL unnest(
    ARRAY['French', 'Spanish', 'German', 'Portuguese', 'Japanese', 'Dutch', 'Italian', 'Mandarin']::text[]
  ) AS lang
  GROUP  BY c.id, c.n_extra_langs
),

-- ─────────────────────────────────────────────────────────────────────────────
-- 4e. Memory type: weighted random from pre-computed mem_r
--     60% short-term | 25% long-term | 10% episodic | 5% none
-- ─────────────────────────────────────────────────────────────────────────────
agent_memory AS (
  SELECT
    c.id,
    CASE
      WHEN c.mem_r < 0.60 THEN 'short-term'
      WHEN c.mem_r < 0.85 THEN 'long-term'
      WHEN c.mem_r < 0.95 THEN 'episodic'
      ELSE                      'none'
    END AS memory_type
  FROM counts c
),

-- ─────────────────────────────────────────────────────────────────────────────
-- 4f. Backdate: spread fleet cohort over 1-90 days
-- ─────────────────────────────────────────────────────────────────────────────
agent_backdate AS (
  SELECT
    c.id,
    now() - (c.backdate_days * interval '1 day') AS backdated
  FROM counts c
)

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Apply all selections in a single UPDATE
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE agents
SET
  displayed_skills          = to_jsonb(s.skills),
  displayed_tools           = to_jsonb(t.tools),
  displayed_specializations = sp.specs,
  displayed_languages       = l.langs,
  displayed_memory_type     = m.memory_type,
  backdated_joined_at       = bd.backdated
FROM
  agent_skills  s
  JOIN agent_tools   t  ON t.id  = s.id
  JOIN agent_specs   sp ON sp.id = s.id
  JOIN agent_langs   l  ON l.id  = s.id
  JOIN agent_memory  m  ON m.id  = s.id
  JOIN agent_backdate bd ON bd.id = s.id
WHERE agents.id = s.id;

COMMIT;

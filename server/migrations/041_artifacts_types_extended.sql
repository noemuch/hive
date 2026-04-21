-- Migration 041 — Extend artifacts.type (multi-archetype support) + media columns
-- #235 A4 · prerequisite for A5 (Showcase non-text), A7 (Hive built by Hive multi-archetype),
--            A16 (C2PA provenance via provenance jsonb).
--
-- Adds non-text artefact types so design / marketing / creative / research
-- agents can publish images, code diffs, audio, video, reports, action traces,
-- structured JSON, and embeddings. Legacy types (ticket, spec, decision,
-- component, pr, document) stay valid — this is additive only, zero row
-- breakage.
--
-- New columns:
--   media_url         text   — Canonical URL for the media payload
--                              (CDN / object storage / provenance-anchored).
--   media_mime        text   — Authoritative MIME type (e.g. image/png,
--                              application/pdf, audio/mpeg). Stored separately
--                              from the URL so the renderer doesn't need to
--                              probe.
--   provenance        jsonb  — Reserved for C2PA manifests (#A16). Shape TBD
--                              by that issue; kept nullable + free-form so A16
--                              can define the schema without a second migration.
--   output_schema_ref text   — URL to the JSON Schema governing a
--                              structured_json artefact's shape. Null for
--                              non-structured types.
--
-- MIGRATION_SLOT_PREFIX=202604211430

ALTER TABLE artifacts
  DROP CONSTRAINT IF EXISTS artifacts_type_check;

ALTER TABLE artifacts
  ADD CONSTRAINT artifacts_type_check CHECK (type IN (
    -- Legacy text types (preserved — existing rows keep validating)
    'ticket',
    'spec',
    'decision',
    'component',
    'pr',
    'document',
    -- A4 extension: rich / creative / machine-readable types
    'message',
    'code_diff',
    'image',
    'audio',
    'video',
    'report',
    'action_trace',
    'structured_json',
    'embedding'
  ));

ALTER TABLE artifacts
  ADD COLUMN IF NOT EXISTS media_url         text,
  ADD COLUMN IF NOT EXISTS media_mime        text,
  ADD COLUMN IF NOT EXISTS provenance        jsonb,
  ADD COLUMN IF NOT EXISTS output_schema_ref text;

COMMENT ON COLUMN artifacts.media_url IS
  'Canonical URL of the media payload for non-text artefacts (image / audio / video / report / action_trace). Null for text-only types.';
COMMENT ON COLUMN artifacts.media_mime IS
  'Authoritative MIME type of media_url (e.g. image/png, application/pdf). Avoids URL sniffing in renderers.';
COMMENT ON COLUMN artifacts.provenance IS
  'C2PA manifest / cryptographic provenance. Reserved for #A16 — shape defined there, kept free-form jsonb here.';
COMMENT ON COLUMN artifacts.output_schema_ref IS
  'URL to the JSON Schema governing a structured_json artefact. Null for non-structured types.';

-- REVERSE MIGRATION (not executed — for reference only):
-- ALTER TABLE artifacts DROP CONSTRAINT artifacts_type_check;
-- ALTER TABLE artifacts ADD CONSTRAINT artifacts_type_check CHECK (type IN (
--   'ticket', 'spec', 'decision', 'component', 'pr', 'document'
-- ));
-- ALTER TABLE artifacts
--   DROP COLUMN media_url,
--   DROP COLUMN media_mime,
--   DROP COLUMN provenance,
--   DROP COLUMN output_schema_ref;

-- Migration 042 — agent_keypairs (C2PA provenance, #244 A16)
-- MIGRATION_SLOT_PREFIX=202604211515
--
-- Ed25519 signing keypairs owned by agents. Each artefact produced by the
-- agent is signed with the (active) private key so third parties can
-- cryptographically verify: who created it, when, with which model, and
-- which peer evaluations contributed to its score.
--
-- Rotation model: history-preserving. To rotate a key, flip the currently
-- active row's `active = false` and INSERT a new row. Old signatures remain
-- verifiable because the public key that signed them is still present (just
-- inactive). The partial index `agent_keypairs_active_unique` guarantees at
-- most one active keypair per agent at any time.
--
-- Keys are generated lazily on the first artefact signing (see
-- server/src/crypto/c2pa.ts::getOrCreateActiveKeypair). This avoids backfill
-- work for existing agents and keeps agent registration cheap.
--
-- The private key is encrypted at rest with AES-256-GCM via the existing
-- `LLM_KEYS_MASTER_KEY` envelope (server/src/security/key-encryption.ts).
-- Stored format: "v1:<base64>". Legacy plaintext is not supported here.

CREATE TABLE IF NOT EXISTS agent_keypairs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  public_key TEXT NOT NULL,
  private_key_encrypted TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  retired_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_agent_keypairs_agent
  ON agent_keypairs(agent_id);

CREATE UNIQUE INDEX IF NOT EXISTS agent_keypairs_active_unique
  ON agent_keypairs(agent_id) WHERE active = TRUE;

COMMENT ON TABLE agent_keypairs IS
  'Ed25519 signing keypairs used for C2PA-style artefact provenance (#244). Rotatable — inactive rows preserved for historical verification.';
COMMENT ON COLUMN agent_keypairs.public_key IS
  'Base64-encoded raw Ed25519 public key (32 bytes). Safe to expose publicly.';
COMMENT ON COLUMN agent_keypairs.private_key_encrypted IS
  'Encrypted private key blob: "v1:<base64>" produced by encryptLLMKey (AES-256-GCM, LLM_KEYS_MASTER_KEY).';
COMMENT ON COLUMN agent_keypairs.active IS
  'At most one active row per agent. Use the partial unique index to enforce.';

-- REVERSE (not executed — reference only):
-- DROP INDEX IF EXISTS agent_keypairs_active_unique;
-- DROP INDEX IF EXISTS idx_agent_keypairs_agent;
-- DROP TABLE IF EXISTS agent_keypairs;

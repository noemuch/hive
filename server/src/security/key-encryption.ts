// Application-layer symmetric encryption for hire.llm_api_key (issue #223).
//
// AES-256-GCM via node:crypto. Chosen over pgcrypto sym_encrypt because passing
// the master secret as a SQL bind variable leaks it to pg_stat_statements,
// slow-query logs, and any auditing tooling that captures bind variables.
//
// Payload format: "v1:" + base64(IV(12B) || ciphertext || authTag(16B)).
// Legacy rows written before this PR have no "v1:" prefix; decryptLLMKey
// returns them unchanged so no data backfill is required to roll this out.
// See docs/LLM_KEY_ROTATION.md for rotation procedure.

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export const ENCRYPTED_KEY_PREFIX = "v1:";
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const MASTER_KEY_BYTES = 32;
const MIN_PAYLOAD_BYTES = IV_BYTES + AUTH_TAG_BYTES + 1;

function loadMasterKey(): Buffer {
  const raw = process.env.LLM_KEYS_MASTER_KEY;
  if (!raw) {
    throw new Error(
      "LLM_KEYS_MASTER_KEY is not set. Generate 32 bytes of hex: `openssl rand -hex 32`."
    );
  }
  const key = Buffer.from(raw, "hex");
  if (key.length !== MASTER_KEY_BYTES) {
    throw new Error(
      `LLM_KEYS_MASTER_KEY must decode to ${MASTER_KEY_BYTES} bytes of hex (got ${key.length}).`
    );
  }
  return key;
}

/** Encrypt plaintext → "v1:<base64>". Throws if master key is absent/invalid. */
export function encryptLLMKey(plaintext: string): string {
  const key = loadMasterKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ENCRYPTED_KEY_PREFIX + Buffer.concat([iv, enc, tag]).toString("base64");
}

/** Decrypt "v1:<base64>" → plaintext. Legacy (no prefix) passes through. */
export function decryptLLMKey(stored: string): string {
  if (!stored.startsWith(ENCRYPTED_KEY_PREFIX)) {
    return stored;
  }
  const key = loadMasterKey();
  const payload = Buffer.from(stored.slice(ENCRYPTED_KEY_PREFIX.length), "base64");
  if (payload.length < MIN_PAYLOAD_BYTES) {
    throw new Error("Encrypted payload is truncated");
  }
  const iv = payload.subarray(0, IV_BYTES);
  const tag = payload.subarray(payload.length - AUTH_TAG_BYTES);
  const ct = payload.subarray(IV_BYTES, payload.length - AUTH_TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(ct), decipher.final()]);
  return dec.toString("utf8");
}

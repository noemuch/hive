# LLM_KEYS_MASTER_KEY Rotation

`LLM_KEYS_MASTER_KEY` encrypts every builder-provided `llm_api_key` stored in
`agent_hires.llm_api_key_encrypted` (AES-256-GCM, payload `v1:<base64>`). A
compromised or rotated master key requires the procedure below.

Implementation: `server/src/security/key-encryption.ts`.

## Generating a key

```bash
openssl rand -hex 32
```

Store the output in your secret manager under `LLM_KEYS_MASTER_KEY`. Never commit.

## First-time enablement

1. Generate a key as above and deploy it to all server instances.
2. Deploy the server code. New hires are encrypted on write; rows created
   before #223 remain plaintext in the column and are passed through by
   `decryptLLMKey` for backward compatibility.
3. Optional — re-key legacy rows:

   ```sql
   SELECT id, llm_api_key_encrypted FROM agent_hires
   WHERE revoked_at IS NULL AND llm_api_key_encrypted NOT LIKE 'v1:%';
   ```

   For each row, `encryptLLMKey(plaintext)` then `UPDATE agent_hires SET
   llm_api_key_encrypted = $1 WHERE id = $2`.

## Routine rotation (recommended quarterly)

Today's format tags ciphertexts with a single `v1:` version and only one master
key is in memory at a time, so live rotation requires a staged roll:

1. **Prepare** — generate `NEW_KEY`. Keep `OLD_KEY` available.
2. **Dual-decrypt shim (temporary code change)** — land a small PR that, inside
   `decryptLLMKey`, tries `NEW_KEY` first then falls back to `OLD_KEY` when the
   auth tag check fails. Deploy with `LLM_KEYS_MASTER_KEY=NEW_KEY` and
   `LLM_KEYS_MASTER_KEY_OLD=OLD_KEY` in the environment.
3. **Re-encrypt at rest** — iterate every live hire:

   ```ts
   const { rows } = await pool.query(
     `SELECT id, llm_api_key_encrypted FROM agent_hires WHERE revoked_at IS NULL`
   );
   for (const r of rows) {
     const plain = decryptLLMKey(r.llm_api_key_encrypted); // tries new, falls back to old
     const next = encryptLLMKey(plain);                    // always new-key ciphertext
     await pool.query(`UPDATE agent_hires SET llm_api_key_encrypted = $1 WHERE id = $2`, [next, r.id]);
   }
   ```

4. **Remove the shim** — revert the dual-decrypt change, remove
   `LLM_KEYS_MASTER_KEY_OLD` from the environment.
5. **Destroy the old key** — revoke it in the secret manager.

## Emergency rotation (suspected compromise)

1. Revoke every hire: `UPDATE agent_hires SET revoked_at = now() WHERE revoked_at IS NULL`.
2. Generate + deploy a fresh `LLM_KEYS_MASTER_KEY`.
3. Notify affected builders — their LLM provider keys may be exposed and must
   also be rotated on the provider side.

## Verification

After any rotation, confirm no plaintext leak in logs:

```bash
# Known provider prefixes. No match expected.
grep -nE '(sk-[A-Za-z0-9_-]{20,}|sk-ant-[A-Za-z0-9_-]{20,}|mistral-[A-Za-z0-9]{20,}|xai-[A-Za-z0-9]{20,})' /var/log/hive-server.log
```

Then confirm every live hire carries the `v1:` marker:

```sql
SELECT COUNT(*) FROM agent_hires
WHERE revoked_at IS NULL AND llm_api_key_encrypted NOT LIKE 'v1:%';
-- expected: 0 after re-key
```

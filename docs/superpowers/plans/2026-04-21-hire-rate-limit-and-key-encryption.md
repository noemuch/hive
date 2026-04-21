# Hire Rate Limiting + LLM Key Encryption — Implementation Plan (#223)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Protect the Phase 6 Hire API with per-hire_token rate limiting (60 req/min) and encrypt hire `llm_api_key` at rest using AES-256-GCM (application-layer, `node:crypto`).

**Architecture:**
- Rate limit — new `server/src/auth/hire-rate-limit.ts` exposing `checkHireTokenRateLimit(prefix)`, plugged into `handleAgentRespond` right after prefix extraction (before DB lookup to protect the DB too).
- Key encryption — new `server/src/security/key-encryption.ts` with `encryptLLMKey(plaintext)` / `decryptLLMKey(ciphertext)` using AES-256-GCM. Payload format: `v1:<base64(iv|ciphertext|tag)>`. Legacy plaintext (no prefix) decrypts to itself for backward compat with rows inserted before this PR.
- Master secret — `LLM_KEYS_MASTER_KEY` env var (64 hex chars = 32 bytes). Missing / wrong length → explicit error at encrypt time, not at import.
- Rotation doc — `docs/LLM_KEY_ROTATION.md` describing the dual-key roll procedure.

**Tech Stack:** Bun, TypeScript, `node:crypto` (built-in, no new deps), existing `pg` Pool, Bun test runner.

---

### Task 1: TDD — hire rate limit helper

**Files:**
- Create: `server/src/auth/hire-rate-limit.ts`
- Create: `server/src/auth/hire-rate-limit.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// server/src/auth/hire-rate-limit.test.ts
import { describe, it, expect, beforeEach } from "bun:test";
import {
  checkHireTokenRateLimit,
  HIRE_RATE_LIMIT_PER_MINUTE,
  __resetHireRateLimitForTests,
} from "./hire-rate-limit";

describe("checkHireTokenRateLimit", () => {
  beforeEach(() => __resetHireRateLimitForTests());

  it("allows up to HIRE_RATE_LIMIT_PER_MINUTE requests per window", () => {
    for (let i = 0; i < HIRE_RATE_LIMIT_PER_MINUTE; i++) {
      expect(checkHireTokenRateLimit("abcd1234")).toBeNull();
    }
  });

  it("returns retry_after (seconds) on the N+1th request", () => {
    for (let i = 0; i < HIRE_RATE_LIMIT_PER_MINUTE; i++) {
      checkHireTokenRateLimit("abcd1234");
    }
    const retry = checkHireTokenRateLimit("abcd1234");
    expect(retry).not.toBeNull();
    expect(retry).toBeGreaterThan(0);
    expect(retry).toBeLessThanOrEqual(60);
  });

  it("tracks prefixes independently", () => {
    for (let i = 0; i < HIRE_RATE_LIMIT_PER_MINUTE; i++) {
      checkHireTokenRateLimit("prefix_a");
    }
    expect(checkHireTokenRateLimit("prefix_a")).not.toBeNull();
    expect(checkHireTokenRateLimit("prefix_b")).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd server && bun test src/auth/hire-rate-limit.test.ts
```

Expected: fails — module does not exist.

- [ ] **Step 3: Implement the module**

```ts
// server/src/auth/hire-rate-limit.ts
// Per hire_token rate limiting for POST /api/agents/:id/respond (issue #223).
// Keyed by hire_token_prefix (first 8 chars) — O(1) and doesn't require the full
// token, so we can enforce the limit BEFORE the bcrypt verify.

type Entry = { count: number; windowStart: number };

export const HIRE_RATE_LIMIT_PER_MINUTE = 60;
const WINDOW_MS = 60_000;

const entries = new Map<string, Entry>();

/** Returns null if allowed, or retry_after (seconds, integer, >=1) if rate limited. */
export function checkHireTokenRateLimit(prefix: string): number | null {
  const now = Date.now();
  const entry = entries.get(prefix);
  if (!entry || now - entry.windowStart > WINDOW_MS) {
    entries.set(prefix, { count: 1, windowStart: now });
    return null;
  }
  if (entry.count >= HIRE_RATE_LIMIT_PER_MINUTE) {
    return Math.max(1, Math.ceil((entry.windowStart + WINDOW_MS - now) / 1000));
  }
  entry.count++;
  return null;
}

/** Test-only. Not exported via index. */
export function __resetHireRateLimitForTests(): void {
  entries.clear();
}

// Cleanup stale entries every 10 min (matches router/rate-limit.ts).
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of entries) {
    if (now - entry.windowStart > WINDOW_MS * 2) entries.delete(key);
  }
}, 10 * 60 * 1000).unref?.();
```

- [ ] **Step 4: Run tests**

```bash
cd server && bun test src/auth/hire-rate-limit.test.ts
```

Expected: 3 passing.

---

### Task 2: TDD — AES-256-GCM key encryption helpers

**Files:**
- Create: `server/src/security/key-encryption.ts`
- Create: `server/src/security/key-encryption.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// server/src/security/key-encryption.test.ts
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { encryptLLMKey, decryptLLMKey, ENCRYPTED_KEY_PREFIX } from "./key-encryption";

// Deterministic 32-byte hex master key for tests only.
const TEST_KEY_HEX = "0".repeat(64);
let previous: string | undefined;

beforeAll(() => {
  previous = process.env.LLM_KEYS_MASTER_KEY;
  process.env.LLM_KEYS_MASTER_KEY = TEST_KEY_HEX;
});
afterAll(() => {
  if (previous === undefined) delete process.env.LLM_KEYS_MASTER_KEY;
  else process.env.LLM_KEYS_MASTER_KEY = previous;
});

describe("encryptLLMKey / decryptLLMKey", () => {
  it("round-trips plaintext", () => {
    const plain = "sk-live-abc123-do-not-use";
    const cipher = encryptLLMKey(plain);
    expect(cipher.startsWith(ENCRYPTED_KEY_PREFIX)).toBe(true);
    expect(cipher).not.toContain(plain);
    expect(decryptLLMKey(cipher)).toBe(plain);
  });

  it("produces distinct ciphertexts for identical plaintext (random IV)", () => {
    const plain = "same-input";
    expect(encryptLLMKey(plain)).not.toBe(encryptLLMKey(plain));
  });

  it("throws when ciphertext is tampered (auth tag mismatch)", () => {
    const plain = "sk-xyz";
    const cipher = encryptLLMKey(plain);
    // Flip the last real ciphertext byte by remapping the base64 payload.
    const body = cipher.slice(ENCRYPTED_KEY_PREFIX.length);
    const bytes = Buffer.from(body, "base64");
    bytes[bytes.length - 1] ^= 0x01;
    const tampered = ENCRYPTED_KEY_PREFIX + bytes.toString("base64");
    expect(() => decryptLLMKey(tampered)).toThrow();
  });

  it("passes through legacy plaintext (no v1: prefix) for backward compat", () => {
    // Rows inserted before #223 have plaintext in llm_api_key_encrypted. Decrypt
    // must treat them as already-plaintext so existing hires keep working.
    expect(decryptLLMKey("plain-legacy-key")).toBe("plain-legacy-key");
  });

  it("throws when master key env var is unset at encrypt time", () => {
    const saved = process.env.LLM_KEYS_MASTER_KEY;
    delete process.env.LLM_KEYS_MASTER_KEY;
    try {
      expect(() => encryptLLMKey("anything")).toThrow(/LLM_KEYS_MASTER_KEY/);
    } finally {
      process.env.LLM_KEYS_MASTER_KEY = saved;
    }
  });

  it("throws when master key has wrong length", () => {
    const saved = process.env.LLM_KEYS_MASTER_KEY;
    process.env.LLM_KEYS_MASTER_KEY = "short";
    try {
      expect(() => encryptLLMKey("anything")).toThrow();
    } finally {
      process.env.LLM_KEYS_MASTER_KEY = saved;
    }
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd server && bun test src/security/key-encryption.test.ts
```

Expected: fails — module does not exist.

- [ ] **Step 3: Implement the module**

```ts
// server/src/security/key-encryption.ts
// Application-layer symmetric encryption for hire.llm_api_key (issue #223).
//
// AES-256-GCM via node:crypto. Chosen over pgcrypto sym_encrypt because passing
// the master secret as a SQL parameter leaks it to pg_stat_statements, slow-query
// logs, and any auditing tooling that captures bind variables.
//
// Payload format: "v1:" + base64(IV(12B) || ciphertext || authTag(16B))
// Legacy rows written before this PR have no "v1:" prefix; decryptLLMKey returns
// them unchanged so the migration does not require a data backfill.

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export const ENCRYPTED_KEY_PREFIX = "v1:";
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const MASTER_KEY_BYTES = 32; // AES-256

function loadMasterKey(): Buffer {
  const raw = process.env.LLM_KEYS_MASTER_KEY;
  if (!raw) {
    throw new Error(
      "LLM_KEYS_MASTER_KEY is not set. Generate 32 bytes of hex: `openssl rand -hex 32`."
    );
  }
  let key: Buffer;
  try {
    key = Buffer.from(raw, "hex");
  } catch {
    throw new Error("LLM_KEYS_MASTER_KEY must be hex-encoded.");
  }
  if (key.length !== MASTER_KEY_BYTES) {
    throw new Error(
      `LLM_KEYS_MASTER_KEY must decode to ${MASTER_KEY_BYTES} bytes (got ${key.length}).`
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
    return stored; // legacy plaintext row
  }
  const key = loadMasterKey();
  const payload = Buffer.from(stored.slice(ENCRYPTED_KEY_PREFIX.length), "base64");
  if (payload.length < IV_BYTES + AUTH_TAG_BYTES + 1) {
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
```

- [ ] **Step 4: Run tests**

```bash
cd server && bun test src/security/key-encryption.test.ts
```

Expected: 6 passing.

---

### Task 3: Integrate encryption into hire creation

**Files:**
- Modify: `server/src/handlers/agent-hires.ts`
- Modify: `server/src/handlers/agent-hires.test.ts`

- [ ] **Step 1: Extend the happy-path test to assert non-plaintext storage**

Add to the "creates a hire and returns the token exactly once" test — after the existing loop — also set `LLM_KEYS_MASTER_KEY` in a `beforeAll` at the top of the file, and assert the `llm_api_key_encrypted` parameter starts with `v1:` rather than the plaintext.

```ts
// Add imports:
import { ENCRYPTED_KEY_PREFIX } from "../security/key-encryption";

// Add at top of file (outside any describe):
import { beforeAll, afterAll } from "bun:test";
let prevMasterKey: string | undefined;
beforeAll(() => {
  prevMasterKey = process.env.LLM_KEYS_MASTER_KEY;
  process.env.LLM_KEYS_MASTER_KEY = "0".repeat(64);
});
afterAll(() => {
  if (prevMasterKey === undefined) delete process.env.LLM_KEYS_MASTER_KEY;
  else process.env.LLM_KEYS_MASTER_KEY = prevMasterKey;
});

// Inside the "creates a hire" test, after the existing secret-leak loop:
const encryptedParam = insert.params[4]; // llm_api_key_encrypted column position
expect(typeof encryptedParam).toBe("string");
expect(encryptedParam).not.toBe("FAKE_TEST_KEY");
expect((encryptedParam as string).startsWith(ENCRYPTED_KEY_PREFIX)).toBe(true);
```

- [ ] **Step 2: Run to verify failure**

```bash
cd server && bun test src/handlers/agent-hires.test.ts
```

Expected: fails — insert param is still plaintext `"FAKE_TEST_KEY"`.

- [ ] **Step 3: Encrypt before insert**

Edit `server/src/handlers/agent-hires.ts`:
- Import `encryptLLMKey` from `../security/key-encryption`.
- Replace the TODO comment at lines 61-63 with the encryption call.
- When `llm_api_key` is null/undefined, pass null to the SQL (no encryption).

```ts
// Top of file:
import { encryptLLMKey } from "../security/key-encryption";

// Replace lines ~41 + 61-64 region:
const llmApiKeyPlain = typeof body.llm_api_key === "string" ? body.llm_api_key : null;
const llmBaseUrl = typeof body.llm_base_url === "string" ? body.llm_base_url : null;
const llmModel = typeof body.llm_model === "string" ? body.llm_model : null;

// ... after expiresAt block:
const llmApiKeyEncrypted = llmApiKeyPlain !== null ? encryptLLMKey(llmApiKeyPlain) : null;

// In the INSERT params array, replace `llmApiKey` with `llmApiKeyEncrypted`.
```

- [ ] **Step 4: Run tests**

```bash
cd server && bun test src/handlers/agent-hires.test.ts
```

Expected: 12 passing (all prior + updated).

---

### Task 4: Integrate decrypt + rate limit into `handleAgentRespond`

**Files:**
- Modify: `server/src/handlers/agent-respond.ts`
- Modify: `server/src/handlers/agent-respond.test.ts`

- [ ] **Step 1: Add test — 429 on 61st request per prefix**

Append a new `describe` block in `agent-respond.test.ts`:

```ts
import { checkHireTokenRateLimit, __resetHireRateLimitForTests, HIRE_RATE_LIMIT_PER_MINUTE } from "../auth/hire-rate-limit";

describe("handleAgentRespond — rate limiting", () => {
  beforeEach(() => {
    __resetCacheForTests();
    __resetHireRateLimitForTests();
  });

  it("returns 429 after HIRE_RATE_LIMIT_PER_MINUTE requests with same prefix", async () => {
    const { token } = await makeHireRow();
    // Burn the quota via the helper — this mirrors what the handler does on every
    // hit, so the 61st real request lands at the limit.
    const prefix = hireTokenPrefix(token);
    for (let i = 0; i < HIRE_RATE_LIMIT_PER_MINUTE; i++) {
      checkHireTokenRateLimit(prefix);
    }
    const { pool } = makePool([]);
    const req = new Request(`http://localhost/api/agents/${AGENT_ID}/respond`, {
      method: "POST",
      headers: bearer(token),
      body: JSON.stringify({ context: "hi" }),
    });
    const res = await handleAgentRespond(req, pool as any, AGENT_ID);
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toBe("rate_limited");
    expect(typeof body.retry_after).toBe("number");
  });
});
```

- [ ] **Step 2: Add test — decrypt path invoked before LLM call**

Also inside a new `describe("handleAgentRespond — encryption", ...)` in the same file:

```ts
import { encryptLLMKey } from "../security/key-encryption";

describe("handleAgentRespond — encryption", () => {
  const prevMasterKey = process.env.LLM_KEYS_MASTER_KEY;
  beforeAll(() => { process.env.LLM_KEYS_MASTER_KEY = "0".repeat(64); });
  afterAll(() => {
    if (prevMasterKey === undefined) delete process.env.LLM_KEYS_MASTER_KEY;
    else process.env.LLM_KEYS_MASTER_KEY = prevMasterKey;
  });
  beforeEach(() => {
    __resetCacheForTests();
    __resetHireRateLimitForTests();
  });

  it("decrypts llm_api_key_encrypted before sending Bearer to LLM", async () => {
    const plain = "sk-real-byok-key";
    const cipher = encryptLLMKey(plain);
    const { token, row } = await makeHireRow({ llm_api_key_encrypted: cipher });
    const { pool } = makePool([
      { rows: [row] },
      { rows: [fakeAgentRow()] },
    ]);
    const fetchMock = mockLLMOk("ok");
    const req = new Request(`http://localhost/api/agents/${AGENT_ID}/respond`, {
      method: "POST",
      headers: bearer(token),
      body: JSON.stringify({ context: "hello" }),
    });
    const res = await handleAgentRespond(req, pool as any, AGENT_ID, {
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(res.status).toBe(200);
    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${plain}`);
  });
});
```

- [ ] **Step 3: Run to verify failure**

```bash
cd server && bun test src/handlers/agent-respond.test.ts
```

Expected: rate-limit test fails (no 429 path) + encryption test fails (Authorization is the raw ciphertext, not decrypted).

- [ ] **Step 4: Wire rate limit + decrypt into the handler**

Edit `server/src/handlers/agent-respond.ts`:
- Import `checkHireTokenRateLimit` from `../auth/hire-rate-limit`.
- Import `decryptLLMKey` from `../security/key-encryption`.
- After extracting `prefix` (~line 87) and BEFORE the DB lookup, call:
  ```ts
  const retryAfter = checkHireTokenRateLimit(prefix);
  if (retryAfter !== null) {
    return json(
      { error: "rate_limited", message: "Too many requests for this hire token", retry_after: retryAfter },
      429
    );
  }
  ```
- Right before the `callLLM({ ... apiKey: hire.llm_api_key_encrypted ... })` block, decrypt:
  ```ts
  let llmApiKey: string;
  try {
    llmApiKey = decryptLLMKey(hire.llm_api_key_encrypted);
  } catch (err) {
    console.error("[agent-respond] failed to decrypt LLM key for hire", hire.id);
    return json({ error: "hire_misconfigured", message: "Hire key unreadable" }, 500);
  }
  ```
  and pass `apiKey: llmApiKey` to `callLLM`.

- [ ] **Step 5: Run tests**

```bash
cd server && bun test src/handlers/agent-respond.test.ts
```

Expected: all passing — previous tests still green, new ones green.

- [ ] **Step 6: Full server suite**

```bash
cd server && bun test
```

Expected: all green.

---

### Task 5: Document master-key rotation

**Files:**
- Create: `docs/LLM_KEY_ROTATION.md`
- Modify: `CLAUDE.md` (Environment Variables table — add `LLM_KEYS_MASTER_KEY`)

- [ ] **Step 1: Write the rotation doc**

```markdown
# LLM_KEYS_MASTER_KEY Rotation

`LLM_KEYS_MASTER_KEY` encrypts every builder-provided `llm_api_key` stored in
`agent_hires.llm_api_key_encrypted` (AES-256-GCM, payload `v1:<base64>`). A
compromised or rotated master key requires the following steps.

## Generating a key

```bash
openssl rand -hex 32
```

Store the output in your secret manager under `LLM_KEYS_MASTER_KEY`. Never commit.

## First-time enablement

1. Generate a key as above and deploy it to all server instances.
2. Deploy the server code — new hires will be encrypted; existing (pre-#223)
   rows remain plaintext and are decrypted unchanged (backward-compat path).
3. Optional: re-key legacy rows by calling a one-shot script that SELECTs every
   hire with `llm_api_key_encrypted NOT LIKE 'v1:%'`, encrypts, and UPDATEs.

## Routine rotation (quarterly recommended)

Because today's format tags ciphertexts with a single `v1:` version and there is
only one master key in memory at a time, live rotation requires a staged roll:

1. **Prepare** — generate `NEW_KEY`. Keep `OLD_KEY` available.
2. **Dual-decrypt shim (temporary code change)** — land a small PR that, inside
   `decryptLLMKey`, tries `NEW_KEY` first then falls back to `OLD_KEY` when the
   auth tag check fails. Deploy with `LLM_KEYS_MASTER_KEY=NEW_KEY` and
   `LLM_KEYS_MASTER_KEY_OLD=OLD_KEY` in the environment.
3. **Re-encrypt at rest** — run a migration script:

   ```sql
   SELECT id, llm_api_key_encrypted FROM agent_hires WHERE revoked_at IS NULL;
   ```

   For each row, decrypt (shim tries new, falls back to old), then `encryptLLMKey`
   (always produces `NEW_KEY` ciphertext), then `UPDATE agent_hires SET
   llm_api_key_encrypted = $1 WHERE id = $2`.
4. **Remove the shim** — revert the dual-decrypt change, remove
   `LLM_KEYS_MASTER_KEY_OLD` from the environment.
5. **Destroy the old key** — revoke it in the secret manager.

## Emergency rotation (suspected compromise)

1. Revoke every hire in the DB: `UPDATE agent_hires SET revoked_at = now() WHERE revoked_at IS NULL`.
2. Generate + deploy a fresh `LLM_KEYS_MASTER_KEY`.
3. Notify affected builders — their LLM provider keys may be exposed and must be
   rotated on the provider side as well.

## Verification

After any rotation, confirm no plaintext leak:

```bash
# Nothing should match the raw key byte sequence in logs.
grep -E 'sk-[A-Za-z0-9_-]{20,}' /var/log/hive-server.log
```

And that all live hires are `v1:`-tagged:

```sql
SELECT COUNT(*) FROM agent_hires
WHERE revoked_at IS NULL AND llm_api_key_encrypted NOT LIKE 'v1:%';
-- expected: 0 after re-key
```
```

- [ ] **Step 2: Add env var to CLAUDE.md table**

Append row in the `## Environment Variables` table under the server block:

```
| `LLM_KEYS_MASTER_KEY`  | *(required in prod — 64 hex chars / 32 bytes)*  | server   |
```

- [ ] **Step 3: Verify no secret patterns match**

```bash
cd /home/runner/work/hive/hive
grep -rnE '(sk-[a-zA-Z0-9_-]{20,}|mistral-[a-zA-Z0-9]{20,})' server/src/security/ server/src/auth/hire-rate-limit.ts docs/LLM_KEY_ROTATION.md
```

Expected: no matches.

---

### Task 6: Self-review + commit

- [ ] **Step 1: Run Quality Gate checks**

```bash
# No secrets / URLs / UUIDs / magic numbers / SELECT * / string concat SQL in changes.
grep -nE '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}' server/src/security/ server/src/auth/hire-rate-limit.ts
```

- [ ] **Step 2: Run the full test suite**

```bash
cd server && bun test
cd ../web && bun run lint  # no web changes but sanity-check
```

- [ ] **Step 3: Commit + push + open PR**

```bash
git add server/src/auth/hire-rate-limit.ts server/src/auth/hire-rate-limit.test.ts \
        server/src/security/key-encryption.ts server/src/security/key-encryption.test.ts \
        server/src/handlers/agent-hires.ts server/src/handlers/agent-hires.test.ts \
        server/src/handlers/agent-respond.ts server/src/handlers/agent-respond.test.ts \
        docs/LLM_KEY_ROTATION.md docs/superpowers/plans/2026-04-21-hire-rate-limit-and-key-encryption.md \
        CLAUDE.md
git commit -m "feat(server): rate limit per hire_token + encrypt llm_api_key at rest (#223)"
git push origin HEAD
```

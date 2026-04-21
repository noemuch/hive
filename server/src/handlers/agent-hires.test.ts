import { describe, it, expect, mock, beforeAll, afterAll } from "bun:test";
import { handleCreateHire, handleListHires, handleRevokeHire } from "./agent-hires";
import { createBuilderToken } from "../auth/index";
import { ENCRYPTED_KEY_PREFIX } from "../security/key-encryption";

const OWNER_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_BUILDER_ID = "22222222-2222-2222-2222-222222222222";
const AGENT_ID = "33333333-3333-3333-3333-333333333333";
const HIRE_ID = "44444444-4444-4444-4444-444444444444";

// Deterministic 32-byte master key for encryption round-trip in tests.
let prevMasterKey: string | undefined;
beforeAll(() => {
  prevMasterKey = process.env.LLM_KEYS_MASTER_KEY;
  process.env.LLM_KEYS_MASTER_KEY = "0".repeat(64);
});
afterAll(() => {
  if (prevMasterKey === undefined) delete process.env.LLM_KEYS_MASTER_KEY;
  else process.env.LLM_KEYS_MASTER_KEY = prevMasterKey;
});

function ownerToken(): string {
  return `Bearer ${createBuilderToken(OWNER_ID)}`;
}
function otherToken(): string {
  return `Bearer ${createBuilderToken(OTHER_BUILDER_ID)}`;
}

type FakeAgentRow = { id: string; builder_id: string };

// Pool factory: scriptable per-call results so we can simulate
// the "load agent" + "insert hire" sequence without a real DB.
function makePool(steps: Array<{ rows: unknown[] }>) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  let i = 0;
  const pool = {
    query: mock(async (sql: string, params: unknown[]) => {
      calls.push({ sql, params });
      const step = steps[i++];
      if (!step) throw new Error(`unexpected query #${i}: ${sql.slice(0, 60)}`);
      return step;
    }),
  };
  return { pool, calls };
}

describe("handleCreateHire", () => {
  it("returns 401 without Authorization header", async () => {
    const { pool } = makePool([]);
    const req = new Request(`http://localhost/api/agents/${AGENT_ID}/hires`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "test" }),
    });
    const res = await handleCreateHire(req, pool as any, AGENT_ID);
    expect(res.status).toBe(401);
  });

  it("returns 404 for unknown agent", async () => {
    const { pool } = makePool([{ rows: [] }]);
    const req = new Request(`http://localhost/api/agents/${AGENT_ID}/hires`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: ownerToken() },
      body: JSON.stringify({ name: "test" }),
    });
    const res = await handleCreateHire(req, pool as any, AGENT_ID);
    expect(res.status).toBe(404);
  });

  it("returns 403 when caller is not the agent owner", async () => {
    const { pool } = makePool([
      { rows: [{ id: AGENT_ID, builder_id: OWNER_ID } as FakeAgentRow] },
    ]);
    const req = new Request(`http://localhost/api/agents/${AGENT_ID}/hires`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: otherToken() },
      body: JSON.stringify({ name: "outsider" }),
    });
    const res = await handleCreateHire(req, pool as any, AGENT_ID);
    expect(res.status).toBe(403);
  });

  it("returns 400 when name is missing", async () => {
    const { pool } = makePool([
      { rows: [{ id: AGENT_ID, builder_id: OWNER_ID } as FakeAgentRow] },
    ]);
    const req = new Request(`http://localhost/api/agents/${AGENT_ID}/hires`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: ownerToken() },
      body: JSON.stringify({}),
    });
    const res = await handleCreateHire(req, pool as any, AGENT_ID);
    expect(res.status).toBe(400);
  });

  it("creates a hire and returns the token exactly once", async () => {
    const { pool, calls } = makePool([
      { rows: [{ id: AGENT_ID, builder_id: OWNER_ID } as FakeAgentRow] },
      { rows: [{ id: HIRE_ID, created_at: new Date(), expires_at: null }] },
    ]);
    const req = new Request(`http://localhost/api/agents/${AGENT_ID}/hires`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: ownerToken() },
      body: JSON.stringify({
        name: "prod-key",
        llm_api_key: "FAKE_TEST_KEY",
        llm_base_url: "FAKE_BASE_URL",
        llm_model: "test-model",
        expires_in_days: 30,
      }),
    });
    const res = await handleCreateHire(req, pool as any, AGENT_ID);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.hire_token).toMatch(/^hire_[0-9a-f]{32}$/);
    expect(body.hire.id).toBe(HIRE_ID);
    // INSERT must NOT carry the plaintext token
    const insert = calls[1];
    expect(insert.sql).toMatch(/INSERT INTO agent_hires/);
    for (const p of insert.params) {
      if (typeof p === "string") {
        expect(p).not.toBe(body.hire_token);
      }
    }
    // INSERT must carry an encrypted llm_api_key (v1: prefix), not the plaintext.
    // Column order: agent_id, hiring_builder_id, hire_token_hash, hire_token_prefix,
    //               llm_api_key_encrypted, llm_base_url, llm_model, expires_at.
    const encryptedParam = insert.params[4];
    expect(typeof encryptedParam).toBe("string");
    expect(encryptedParam).not.toBe("FAKE_TEST_KEY");
    expect((encryptedParam as string).startsWith(ENCRYPTED_KEY_PREFIX)).toBe(true);
  });
});

describe("handleListHires", () => {
  it("returns 401 without Authorization header", async () => {
    const { pool } = makePool([]);
    const req = new Request(`http://localhost/api/agents/${AGENT_ID}/hires`, { method: "GET" });
    const res = await handleListHires(req, pool as any, AGENT_ID);
    expect(res.status).toBe(401);
  });

  it("returns 403 when caller is not the agent owner", async () => {
    const { pool } = makePool([
      { rows: [{ id: AGENT_ID, builder_id: OWNER_ID } as FakeAgentRow] },
    ]);
    const req = new Request(`http://localhost/api/agents/${AGENT_ID}/hires`, {
      method: "GET",
      headers: { Authorization: otherToken() },
    });
    const res = await handleListHires(req, pool as any, AGENT_ID);
    expect(res.status).toBe(403);
  });

  it("returns hires without leaking secrets", async () => {
    const { pool } = makePool([
      { rows: [{ id: AGENT_ID, builder_id: OWNER_ID } as FakeAgentRow] },
      {
        rows: [
          {
            id: HIRE_ID,
            name: "prod-key",
            hire_token_prefix: "hire_abc",
            llm_base_url: "FAKE_BASE_URL",
            llm_model: "test-model",
            created_at: new Date(),
            expires_at: null,
            revoked_at: null,
            calls_count: 0,
            last_called_at: null,
          },
        ],
      },
    ]);
    const req = new Request(`http://localhost/api/agents/${AGENT_ID}/hires`, {
      method: "GET",
      headers: { Authorization: ownerToken() },
    });
    const res = await handleListHires(req, pool as any, AGENT_ID);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.hires)).toBe(true);
    expect(body.hires[0].id).toBe(HIRE_ID);
    expect(body.hires[0]).not.toHaveProperty("hire_token");
    expect(body.hires[0]).not.toHaveProperty("hire_token_hash");
    expect(body.hires[0]).not.toHaveProperty("llm_api_key_encrypted");
  });
});

describe("handleRevokeHire", () => {
  it("returns 401 without Authorization header", async () => {
    const { pool } = makePool([]);
    const req = new Request(`http://localhost/api/agents/${AGENT_ID}/hires/${HIRE_ID}`, {
      method: "DELETE",
    });
    const res = await handleRevokeHire(req, pool as any, AGENT_ID, HIRE_ID);
    expect(res.status).toBe(401);
  });

  it("returns 404 when agent does not exist", async () => {
    const { pool } = makePool([{ rows: [] }]);
    const req = new Request(`http://localhost/api/agents/${AGENT_ID}/hires/${HIRE_ID}`, {
      method: "DELETE",
      headers: { Authorization: ownerToken() },
    });
    const res = await handleRevokeHire(req, pool as any, AGENT_ID, HIRE_ID);
    expect(res.status).toBe(404);
  });

  it("returns 403 when caller is not the agent owner", async () => {
    const { pool } = makePool([
      { rows: [{ id: AGENT_ID, builder_id: OWNER_ID } as FakeAgentRow] },
    ]);
    const req = new Request(`http://localhost/api/agents/${AGENT_ID}/hires/${HIRE_ID}`, {
      method: "DELETE",
      headers: { Authorization: otherToken() },
    });
    const res = await handleRevokeHire(req, pool as any, AGENT_ID, HIRE_ID);
    expect(res.status).toBe(403);
  });

  it("returns 404 when hire does not match agent (UPDATE affects 0 rows)", async () => {
    const { pool } = makePool([
      { rows: [{ id: AGENT_ID, builder_id: OWNER_ID } as FakeAgentRow] },
      { rows: [] },
    ]);
    const req = new Request(`http://localhost/api/agents/${AGENT_ID}/hires/${HIRE_ID}`, {
      method: "DELETE",
      headers: { Authorization: ownerToken() },
    });
    const res = await handleRevokeHire(req, pool as any, AGENT_ID, HIRE_ID);
    expect(res.status).toBe(404);
  });

  it("returns 204 and stamps revoked_at when caller owns the agent", async () => {
    const { pool, calls } = makePool([
      { rows: [{ id: AGENT_ID, builder_id: OWNER_ID } as FakeAgentRow] },
      { rows: [{ id: HIRE_ID }] },
    ]);
    const req = new Request(`http://localhost/api/agents/${AGENT_ID}/hires/${HIRE_ID}`, {
      method: "DELETE",
      headers: { Authorization: ownerToken() },
    });
    const res = await handleRevokeHire(req, pool as any, AGENT_ID, HIRE_ID);
    expect(res.status).toBe(204);
    const update = calls[1];
    expect(update.sql).toMatch(/UPDATE agent_hires/);
    expect(update.sql).toMatch(/revoked_at/);
    expect(update.params).toContain(HIRE_ID);
    expect(update.params).toContain(AGENT_ID);
  });
});

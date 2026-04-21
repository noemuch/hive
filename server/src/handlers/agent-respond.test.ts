import { describe, it, expect, mock, beforeEach } from "bun:test";
import {
  handleAgentRespond,
  __resetCacheForTests,
} from "./agent-respond";
import { generateHireToken, hashHireToken, hireTokenPrefix } from "../auth/hire-token";

const AGENT_ID = "55555555-5555-5555-5555-555555555555";
const HIRE_ID = "66666666-6666-6666-6666-666666666666";
const OTHER_AGENT_ID = "77777777-7777-7777-7777-777777777777";

const FAKE_LLM_KEY = "FAKE_TEST_LLM_KEY_DO_NOT_USE";
const FAKE_LLM_BASE = "https://llm.example.invalid/v1";
const FAKE_LLM_MODEL = "test-model-1";

type FakeStep = { rows: unknown[] };

// Mock pool: scripted steps consumed in order. Telemetry inserts (INSERT INTO
// agent_hire_calls / UPDATE agent_hires SET calls_count) are fire-and-forget in
// the handler, so they race with subsequent test requests. We auto-swallow them
// here so individual tests don't need to script telemetry rows.
function makePool(steps: FakeStep[]) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  let i = 0;
  const pool = {
    query: mock(async (sql: string, params: unknown[]) => {
      calls.push({ sql, params });
      if (
        sql.includes("INSERT INTO agent_hire_calls") ||
        (sql.includes("UPDATE agent_hires") && sql.includes("calls_count"))
      ) {
        return { rows: [] };
      }
      const step = steps[i++];
      if (!step) throw new Error(`unexpected query #${i}: ${sql.slice(0, 80)}`);
      return step;
    }),
  };
  return { pool, calls };
}

// Yield control so fire-and-forget telemetry microtasks settle before the next
// test request — keeps the mock-pool step pointer in sync with handler reads.
async function flushMicrotasks(): Promise<void> {
  await new Promise((r) => setImmediate(r));
}

async function makeHireRow(overrides: Partial<Record<string, unknown>> = {}) {
  const token = generateHireToken();
  const hash = await hashHireToken(token);
  const prefix = hireTokenPrefix(token);
  return {
    token,
    prefix,
    row: {
      id: HIRE_ID,
      agent_id: AGENT_ID,
      hire_token_hash: hash,
      llm_api_key_encrypted: FAKE_LLM_KEY,
      llm_base_url: FAKE_LLM_BASE,
      llm_model: FAKE_LLM_MODEL,
      revoked_at: null,
      expires_at: null,
      ...overrides,
    },
  };
}

function fakeAgentRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: AGENT_ID,
    name: "Ada",
    role: "engineer",
    personality_brief: "Builds clean APIs.",
    status: "active",
    ...overrides,
  };
}

function mockLLMOk(text = "Hi from LLM") {
  return mock(async () =>
    new Response(
      JSON.stringify({
        choices: [{ message: { content: text } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    )
  );
}

function bearer(token: string): Record<string, string> {
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

describe("handleAgentRespond — auth", () => {
  beforeEach(() => __resetCacheForTests());

  it("returns 404 when :id is not a UUID", async () => {
    const { pool } = makePool([]);
    const req = new Request("http://localhost/api/agents/not-a-uuid/respond", {
      method: "POST",
      headers: bearer("hire_abcdef"),
      body: JSON.stringify({ context: "hi" }),
    });
    const res = await handleAgentRespond(req, pool as any, "not-a-uuid");
    expect(res.status).toBe(404);
  });

  it("returns 401 when Authorization header missing", async () => {
    const { pool } = makePool([]);
    const req = new Request(`http://localhost/api/agents/${AGENT_ID}/respond`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ context: "hi" }),
    });
    const res = await handleAgentRespond(req, pool as any, AGENT_ID);
    expect(res.status).toBe(401);
  });

  it("returns 401 when token does not start with hire_", async () => {
    const { pool } = makePool([]);
    const req = new Request(`http://localhost/api/agents/${AGENT_ID}/respond`, {
      method: "POST",
      headers: bearer("not_a_hire_token"),
      body: JSON.stringify({ context: "hi" }),
    });
    const res = await handleAgentRespond(req, pool as any, AGENT_ID);
    expect(res.status).toBe(401);
  });

  it("returns 401 when token prefix matches no hire", async () => {
    const { pool } = makePool([{ rows: [] }]);
    const req = new Request(`http://localhost/api/agents/${AGENT_ID}/respond`, {
      method: "POST",
      headers: bearer("hire_deadbeefdeadbeefdeadbeefdeadbeef"),
      body: JSON.stringify({ context: "hi" }),
    });
    const res = await handleAgentRespond(req, pool as any, AGENT_ID);
    expect(res.status).toBe(401);
  });

  it("returns 401 when the bcrypt verify fails (wrong full token)", async () => {
    const { row, prefix } = await makeHireRow();
    const { pool } = makePool([{ rows: [row] }]);
    const wrongToken = `${prefix}_wrong_full_token_padding_here_for_format`;
    const req = new Request(`http://localhost/api/agents/${AGENT_ID}/respond`, {
      method: "POST",
      headers: bearer(wrongToken),
      body: JSON.stringify({ context: "hi" }),
    });
    const res = await handleAgentRespond(req, pool as any, AGENT_ID);
    expect(res.status).toBe(401);
  });

  it("returns 410 when hire is revoked", async () => {
    const { token, row } = await makeHireRow({ revoked_at: new Date() });
    const { pool } = makePool([{ rows: [row] }]);
    const req = new Request(`http://localhost/api/agents/${AGENT_ID}/respond`, {
      method: "POST",
      headers: bearer(token),
      body: JSON.stringify({ context: "hi" }),
    });
    const res = await handleAgentRespond(req, pool as any, AGENT_ID);
    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body.error).toBe("hire_revoked");
  });

  it("returns 410 when hire is expired", async () => {
    const past = new Date(Date.now() - 1000);
    const { token, row } = await makeHireRow({ expires_at: past });
    const { pool } = makePool([{ rows: [row] }]);
    const req = new Request(`http://localhost/api/agents/${AGENT_ID}/respond`, {
      method: "POST",
      headers: bearer(token),
      body: JSON.stringify({ context: "hi" }),
    });
    const res = await handleAgentRespond(req, pool as any, AGENT_ID);
    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body.error).toBe("hire_expired");
  });

  it("returns 403 when hire.agent_id does not match URL :id", async () => {
    const { token, row } = await makeHireRow({ agent_id: OTHER_AGENT_ID });
    const { pool } = makePool([{ rows: [row] }]);
    const req = new Request(`http://localhost/api/agents/${AGENT_ID}/respond`, {
      method: "POST",
      headers: bearer(token),
      body: JSON.stringify({ context: "hi" }),
    });
    const res = await handleAgentRespond(req, pool as any, AGENT_ID);
    expect(res.status).toBe(403);
  });
});

describe("handleAgentRespond — body validation", () => {
  beforeEach(() => __resetCacheForTests());

  it("returns 400 when body is missing context", async () => {
    const { token, row } = await makeHireRow();
    const { pool } = makePool([
      { rows: [row] },
      { rows: [fakeAgentRow()] },
    ]);
    const req = new Request(`http://localhost/api/agents/${AGENT_ID}/respond`, {
      method: "POST",
      headers: bearer(token),
      body: JSON.stringify({}),
    });
    const res = await handleAgentRespond(req, pool as any, AGENT_ID);
    expect(res.status).toBe(400);
  });

  it("returns 400 when context exceeds size cap", async () => {
    const { token, row } = await makeHireRow();
    const { pool } = makePool([
      { rows: [row] },
      { rows: [fakeAgentRow()] },
    ]);
    const huge = "a".repeat(20_000);
    const req = new Request(`http://localhost/api/agents/${AGENT_ID}/respond`, {
      method: "POST",
      headers: bearer(token),
      body: JSON.stringify({ context: huge }),
    });
    const res = await handleAgentRespond(req, pool as any, AGENT_ID);
    expect(res.status).toBe(400);
  });
});

describe("handleAgentRespond — agent state", () => {
  beforeEach(() => __resetCacheForTests());

  it("returns 410 when agent is retired", async () => {
    const { token, row } = await makeHireRow();
    const { pool } = makePool([
      { rows: [row] },
      { rows: [fakeAgentRow({ status: "retired" })] },
    ]);
    const req = new Request(`http://localhost/api/agents/${AGENT_ID}/respond`, {
      method: "POST",
      headers: bearer(token),
      body: JSON.stringify({ context: "hi" }),
    });
    const res = await handleAgentRespond(req, pool as any, AGENT_ID);
    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body.error).toBe("agent_retired");
  });

  it("returns 404 when agent disappeared between hire creation and call", async () => {
    const { token, row } = await makeHireRow();
    const { pool } = makePool([
      { rows: [row] },
      { rows: [] },
    ]);
    const req = new Request(`http://localhost/api/agents/${AGENT_ID}/respond`, {
      method: "POST",
      headers: bearer(token),
      body: JSON.stringify({ context: "hi" }),
    });
    const res = await handleAgentRespond(req, pool as any, AGENT_ID);
    expect(res.status).toBe(404);
  });
});

describe("handleAgentRespond — happy path", () => {
  beforeEach(() => __resetCacheForTests());

  it("returns 200 with response, usage, latency_ms when LLM call succeeds", async () => {
    const { token, row } = await makeHireRow();
    const { pool } = makePool([
      { rows: [row] },
      { rows: [fakeAgentRow()] },
    ]);
    const fetchMock = mockLLMOk("Hello user!");
    const req = new Request(`http://localhost/api/agents/${AGENT_ID}/respond`, {
      method: "POST",
      headers: bearer(token),
      body: JSON.stringify({ context: "Say hi" }),
    });
    const res = await handleAgentRespond(req, pool as any, AGENT_ID, {
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.response).toBe("Hello user!");
    expect(body.usage.tokens.total_tokens).toBe(15);
    expect(typeof body.usage.cost_estimate).toBe("number");
    expect(typeof body.latency_ms).toBe("number");
    expect(body.cached).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [callUrl, callInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(callUrl).toBe(`${FAKE_LLM_BASE}/chat/completions`);
    const headers = (callInit.headers ?? {}) as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${FAKE_LLM_KEY}`);
    const sentBody = JSON.parse(callInit.body as string);
    expect(sentBody.model).toBe(FAKE_LLM_MODEL);
    expect(sentBody.messages[0].role).toBe("system");
    expect(sentBody.messages[0].content).toContain("Ada");
    expect(sentBody.messages[0].content).toContain("engineer");
    expect(sentBody.messages[1]).toEqual({ role: "user", content: "Say hi" });
  });

  it("returns cached response on repeated identical context within TTL", async () => {
    const { token, row } = await makeHireRow();
    const { pool } = makePool([
      { rows: [row] },
      { rows: [fakeAgentRow()] },
      { rows: [row] },
      { rows: [fakeAgentRow()] },
    ]);
    const fetchMock = mockLLMOk("cached me");
    const make = () =>
      new Request(`http://localhost/api/agents/${AGENT_ID}/respond`, {
        method: "POST",
        headers: bearer(token),
        body: JSON.stringify({ context: "exact same input" }),
      });

    const first = await handleAgentRespond(make(), pool as any, AGENT_ID, {
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(first.status).toBe(200);
    await flushMicrotasks();

    const second = await handleAgentRespond(make(), pool as any, AGENT_ID, {
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(second.status).toBe(200);
    const secondBody = await second.json();
    expect(secondBody.cached).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1); // second served from cache
  });
});

describe("handleAgentRespond — failures", () => {
  beforeEach(() => __resetCacheForTests());

  it("returns 502 when the LLM upstream returns non-2xx", async () => {
    const { token, row } = await makeHireRow();
    const { pool } = makePool([
      { rows: [row] },
      { rows: [fakeAgentRow()] },
    ]);
    const fetchMock = mock(
      async () => new Response("LLM 5xx", { status: 503 })
    );
    const req = new Request(`http://localhost/api/agents/${AGENT_ID}/respond`, {
      method: "POST",
      headers: bearer(token),
      body: JSON.stringify({ context: "hi" }),
    });
    const res = await handleAgentRespond(req, pool as any, AGENT_ID, {
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe("llm_error");
  });

  it("returns 502 when the LLM call throws (network error)", async () => {
    const { token, row } = await makeHireRow();
    const { pool } = makePool([
      { rows: [row] },
      { rows: [fakeAgentRow()] },
    ]);
    const fetchMock = mock(async () => {
      throw new Error("ECONNREFUSED");
    });
    const req = new Request(`http://localhost/api/agents/${AGENT_ID}/respond`, {
      method: "POST",
      headers: bearer(token),
      body: JSON.stringify({ context: "hi" }),
    });
    const res = await handleAgentRespond(req, pool as any, AGENT_ID, {
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(res.status).toBe(502);
  });
});

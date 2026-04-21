import { describe, it, expect, mock } from "bun:test";
import {
  handleShowcaseGet,
  handleShowcasePin,
  handleShowcaseUnpin,
} from "../agent-showcase";
import { createBuilderToken } from "../../auth/index";

// Pool mock pattern: same as agent-profile.test.ts — classify SQL by
// substring, return canned rows. `pool.connect()` returns a mock client
// whose `query()` also routes through the classifier so the transactional
// code path (BEGIN / INSERT / UPDATE / COMMIT) can be tested without a
// real DB.

const AGENT_UUID = "11111111-1111-1111-1111-111111111111";
const OTHER_AGENT_UUID = "22222222-2222-2222-2222-222222222222";
const ARTIFACT_UUID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const BUILDER_UUID = "33333333-3333-3333-3333-333333333333";
const OTHER_BUILDER_UUID = "44444444-4444-4444-4444-444444444444";

type CallLog = Array<{ sql: string; params: unknown[] }>;

function classify(sql: string): string {
  if (/FROM\s+agent_showcase\s+s/i.test(sql) && /JOIN\s+artifacts/i.test(sql)) return "list_pins";
  if (/SELECT\s+id,\s*builder_id\s+FROM\s+agents/i.test(sql)) return "load_agent";
  if (/FROM\s+artifacts\s+WHERE\s+id/i.test(sql)) return "load_artifact";
  if (/SELECT\s+position\s+FROM\s+agent_showcase\s+WHERE/i.test(sql)) return "count_pins";
  if (sql.trim().toUpperCase() === "BEGIN") return "begin";
  if (sql.trim().toUpperCase() === "COMMIT") return "commit";
  if (sql.trim().toUpperCase() === "ROLLBACK") return "rollback";
  if (/INSERT\s+INTO\s+agent_showcase/i.test(sql)) return "insert_pin";
  if (/UPDATE\s+artifacts\s+SET\s+is_showcase_public/i.test(sql)) return "update_flag";
  if (/DELETE\s+FROM\s+agent_showcase/i.test(sql)) return "delete_pin";
  return "unknown";
}

function makePool(opts: {
  listPinsRows?: Record<string, unknown>[];
  loadAgentRows?: Record<string, unknown>[];
  loadArtifactRows?: Record<string, unknown>[];
  existingPositions?: number[];
  deleteReturns?: Record<string, unknown>[];
  insertError?: { code?: string } | null;
}) {
  const calls: CallLog = [];
  const routeQuery = (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    const kind = classify(sql);
    switch (kind) {
      case "list_pins":
        return { rows: opts.listPinsRows ?? [] };
      case "load_agent":
        return { rows: opts.loadAgentRows ?? [] };
      case "load_artifact":
        return { rows: opts.loadArtifactRows ?? [] };
      case "count_pins":
        return {
          rows: (opts.existingPositions ?? []).map((p) => ({ position: p })),
        };
      case "begin":
      case "commit":
      case "rollback":
      case "update_flag":
        return { rows: [] };
      case "insert_pin":
        if (opts.insertError) {
          const err = new Error("insert failed") as Error & { code?: string };
          err.code = opts.insertError.code;
          throw err;
        }
        return { rows: [] };
      case "delete_pin":
        return { rows: opts.deleteReturns ?? [] };
      default:
        return { rows: [] };
    }
  };

  const client = {
    query: mock(async (sql: string, params?: unknown[]) => routeQuery(sql, params)),
    release: mock(() => {}),
  };

  const pool = {
    query: mock(async (sql: string, params?: unknown[]) => routeQuery(sql, params)),
    connect: mock(async () => client),
  };

  return { pool, client, calls };
}

function authHeader(builderId: string): HeadersInit {
  return { Authorization: `Bearer ${createBuilderToken(builderId)}` };
}

describe("handleShowcaseGet", () => {
  it("returns 404 for invalid UUID without querying", async () => {
    const { pool } = makePool({});
    const res = await handleShowcaseGet("not-a-uuid", pool as never);
    expect(res.status).toBe(404);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("returns empty pin list when no rows", async () => {
    const { pool } = makePool({ listPinsRows: [] });
    const res = await handleShowcaseGet(AGENT_UUID, pool as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pins).toEqual([]);
  });

  it("maps rows into the pin payload shape", async () => {
    const { pool } = makePool({
      listPinsRows: [
        {
          position: 1,
          pinned_at: "2026-04-21T10:00:00Z",
          artifact_id: ARTIFACT_UUID,
          artifact_type: "report",
          artifact_title: "Q2 retro",
          artifact_content: "…",
          artifact_created_at: "2026-04-01T08:00:00Z",
          artifact_media_url: null,
          artifact_media_mime: null,
          score: "7.5",
        },
      ],
    });
    const res = await handleShowcaseGet(AGENT_UUID, pool as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pins).toHaveLength(1);
    expect(body.pins[0]).toEqual({
      position: 1,
      pinned_at: "2026-04-21T10:00:00Z",
      artifact: {
        id: ARTIFACT_UUID,
        type: "report",
        title: "Q2 retro",
        content: "…",
        created_at: "2026-04-01T08:00:00Z",
        media_url: null,
        media_mime: null,
        score: 7.5,
      },
    });
  });
});

describe("handleShowcasePin", () => {
  it("rejects missing auth header", async () => {
    const { pool } = makePool({});
    const req = new Request("http://x/api/agents/x/showcase", {
      method: "POST",
      body: JSON.stringify({ artifact_id: ARTIFACT_UUID }),
    });
    const res = await handleShowcasePin(req, pool as never, AGENT_UUID);
    expect(res.status).toBe(401);
  });

  it("rejects cross-builder attempts with 403", async () => {
    const { pool } = makePool({
      loadAgentRows: [{ id: AGENT_UUID, builder_id: OTHER_BUILDER_UUID }],
    });
    const req = new Request("http://x/api/agents/x/showcase", {
      method: "POST",
      headers: authHeader(BUILDER_UUID),
      body: JSON.stringify({ artifact_id: ARTIFACT_UUID }),
    });
    const res = await handleShowcasePin(req, pool as never, AGENT_UUID);
    expect(res.status).toBe(403);
  });

  it("rejects invalid artifact_id with 400", async () => {
    const { pool } = makePool({
      loadAgentRows: [{ id: AGENT_UUID, builder_id: BUILDER_UUID }],
    });
    const req = new Request("http://x/api/agents/x/showcase", {
      method: "POST",
      headers: authHeader(BUILDER_UUID),
      body: JSON.stringify({ artifact_id: "not-a-uuid" }),
    });
    const res = await handleShowcasePin(req, pool as never, AGENT_UUID);
    expect(res.status).toBe(400);
  });

  it("rejects pinning another agent's artefact with 403", async () => {
    const { pool } = makePool({
      loadAgentRows: [{ id: AGENT_UUID, builder_id: BUILDER_UUID }],
      loadArtifactRows: [{ author_id: OTHER_AGENT_UUID }],
    });
    const req = new Request("http://x/api/agents/x/showcase", {
      method: "POST",
      headers: authHeader(BUILDER_UUID),
      body: JSON.stringify({ artifact_id: ARTIFACT_UUID }),
    });
    const res = await handleShowcasePin(req, pool as never, AGENT_UUID);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.message).toContain("not authored by this agent");
  });

  it("rejects when 5 pins already held (ceiling)", async () => {
    const { pool } = makePool({
      loadAgentRows: [{ id: AGENT_UUID, builder_id: BUILDER_UUID }],
      loadArtifactRows: [{ author_id: AGENT_UUID }],
      existingPositions: [1, 2, 3, 4, 5],
    });
    const req = new Request("http://x/api/agents/x/showcase", {
      method: "POST",
      headers: authHeader(BUILDER_UUID),
      body: JSON.stringify({ artifact_id: ARTIFACT_UUID }),
    });
    const res = await handleShowcasePin(req, pool as never, AGENT_UUID);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("showcase_full");
  });

  it("auto-assigns the lowest free slot when position omitted", async () => {
    const { pool, calls } = makePool({
      loadAgentRows: [{ id: AGENT_UUID, builder_id: BUILDER_UUID }],
      loadArtifactRows: [{ author_id: AGENT_UUID }],
      existingPositions: [1, 3, 4],
    });
    const req = new Request("http://x/api/agents/x/showcase", {
      method: "POST",
      headers: authHeader(BUILDER_UUID),
      body: JSON.stringify({ artifact_id: ARTIFACT_UUID }),
    });
    const res = await handleShowcasePin(req, pool as never, AGENT_UUID);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.pin.position).toBe(2);
    // Transaction ran: BEGIN + INSERT + UPDATE + COMMIT in order.
    const txKinds = calls.map((c) => classify(c.sql));
    expect(txKinds).toContain("begin");
    expect(txKinds).toContain("insert_pin");
    expect(txKinds).toContain("update_flag");
    expect(txKinds).toContain("commit");
  });

  it("flips is_showcase_public=true in the same transaction as insert", async () => {
    const { pool, calls } = makePool({
      loadAgentRows: [{ id: AGENT_UUID, builder_id: BUILDER_UUID }],
      loadArtifactRows: [{ author_id: AGENT_UUID }],
      existingPositions: [],
    });
    const req = new Request("http://x/api/agents/x/showcase", {
      method: "POST",
      headers: authHeader(BUILDER_UUID),
      body: JSON.stringify({ artifact_id: ARTIFACT_UUID, position: 2 }),
    });
    const res = await handleShowcasePin(req, pool as never, AGENT_UUID);
    expect(res.status).toBe(201);
    // BEGIN must come before INSERT; UPDATE of is_showcase_public must come
    // before COMMIT; ROLLBACK must not have fired.
    const kinds = calls.map((c) => classify(c.sql));
    const iBegin = kinds.indexOf("begin");
    const iInsert = kinds.indexOf("insert_pin");
    const iUpdate = kinds.indexOf("update_flag");
    const iCommit = kinds.indexOf("commit");
    expect(iBegin).toBeGreaterThan(-1);
    expect(iInsert).toBeGreaterThan(iBegin);
    expect(iUpdate).toBeGreaterThan(iInsert);
    expect(iCommit).toBeGreaterThan(iUpdate);
    expect(kinds).not.toContain("rollback");
  });

  it("maps Postgres 23505 (unique_violation) to 409 conflict", async () => {
    const { pool } = makePool({
      loadAgentRows: [{ id: AGENT_UUID, builder_id: BUILDER_UUID }],
      loadArtifactRows: [{ author_id: AGENT_UUID }],
      existingPositions: [],
      insertError: { code: "23505" },
    });
    const req = new Request("http://x/api/agents/x/showcase", {
      method: "POST",
      headers: authHeader(BUILDER_UUID),
      body: JSON.stringify({ artifact_id: ARTIFACT_UUID, position: 1 }),
    });
    const res = await handleShowcasePin(req, pool as never, AGENT_UUID);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("conflict");
  });
});

describe("handleShowcaseUnpin", () => {
  it("rejects missing auth", async () => {
    const { pool } = makePool({});
    const req = new Request("http://x/api/agents/x/showcase/1", {
      method: "DELETE",
    });
    const res = await handleShowcaseUnpin(req, pool as never, AGENT_UUID, "1");
    expect(res.status).toBe(401);
  });

  it("rejects invalid position param", async () => {
    const { pool } = makePool({
      loadAgentRows: [{ id: AGENT_UUID, builder_id: BUILDER_UUID }],
    });
    const req = new Request("http://x/api/agents/x/showcase/99", {
      method: "DELETE",
      headers: authHeader(BUILDER_UUID),
    });
    const res = await handleShowcaseUnpin(req, pool as never, AGENT_UUID, "99");
    expect(res.status).toBe(400);
  });

  it("returns 404 when no pin exists at that position", async () => {
    const { pool } = makePool({
      loadAgentRows: [{ id: AGENT_UUID, builder_id: BUILDER_UUID }],
      deleteReturns: [],
    });
    const req = new Request("http://x/api/agents/x/showcase/3", {
      method: "DELETE",
      headers: authHeader(BUILDER_UUID),
    });
    const res = await handleShowcaseUnpin(req, pool as never, AGENT_UUID, "3");
    expect(res.status).toBe(404);
  });

  it("returns 204 and clears is_showcase_public on successful unpin", async () => {
    const { pool, calls } = makePool({
      loadAgentRows: [{ id: AGENT_UUID, builder_id: BUILDER_UUID }],
      deleteReturns: [{ artifact_id: ARTIFACT_UUID }],
    });
    const req = new Request("http://x/api/agents/x/showcase/2", {
      method: "DELETE",
      headers: authHeader(BUILDER_UUID),
    });
    const res = await handleShowcaseUnpin(req, pool as never, AGENT_UUID, "2");
    expect(res.status).toBe(204);
    const kinds = calls.map((c) => classify(c.sql));
    expect(kinds).toContain("delete_pin");
    expect(kinds).toContain("update_flag");
    expect(kinds).toContain("commit");
  });
});

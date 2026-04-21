import { describe, it, expect, mock } from "bun:test";
import {
  handleListTools,
  handleGetTool,
  handleCreateTool,
  handleAttachTool,
  handleDetachTool,
} from "./tools";
import { createBuilderToken } from "../auth/index";

const OWNER_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_BUILDER_ID = "22222222-2222-2222-2222-222222222222";
const AGENT_ID = "33333333-3333-3333-3333-333333333333";
const TOOL_ID = "77777777-7777-7777-7777-777777777777";

function ownerToken(): string { return `Bearer ${createBuilderToken(OWNER_ID)}`; }
function otherToken(): string { return `Bearer ${createBuilderToken(OTHER_BUILDER_ID)}`; }

type Step = { rows: unknown[] } | { reject: { code: string; message?: string } };

function makePool(steps: Step[]) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  let i = 0;
  const pool = {
    query: mock(async (sql: string, params: unknown[]) => {
      calls.push({ sql, params });
      const step = steps[i++];
      if (!step) throw new Error(`unexpected query #${i}: ${sql.slice(0, 60)}`);
      if ("reject" in step) {
        throw Object.assign(new Error(step.reject.message ?? "pg-error"), { code: step.reject.code });
      }
      return step;
    }),
  };
  return { pool, calls };
}

describe("handleListTools", () => {
  it("returns 200 with rows", async () => {
    const { pool } = makePool([
      { rows: [{ id: "t", slug: "fetch", title: "Fetch", protocol: "http" }] },
    ]);
    const res = await handleListTools(new URL("http://localhost/api/tools"), pool as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tools).toHaveLength(1);
  });

  it("filters protocol when valid", async () => {
    const { pool, calls } = makePool([{ rows: [] }]);
    await handleListTools(new URL("http://localhost/api/tools?protocol=mcp"), pool as any);
    expect(calls[0].params).toContain("mcp");
  });

  it("ignores invalid protocol", async () => {
    const { pool, calls } = makePool([{ rows: [] }]);
    await handleListTools(new URL("http://localhost/api/tools?protocol=bogus"), pool as any);
    expect(calls[0].params).not.toContain("bogus");
  });

  it("filters category when given", async () => {
    const { pool, calls } = makePool([{ rows: [] }]);
    await handleListTools(new URL("http://localhost/api/tools?category=data"), pool as any);
    expect(calls[0].params).toContain("data");
  });
});

describe("handleGetTool", () => {
  it("400 when slug invalid", async () => {
    const { pool } = makePool([]);
    const res = await handleGetTool("BAD SLUG", pool as any);
    expect(res.status).toBe(400);
  });

  it("404 when slug unknown", async () => {
    const { pool } = makePool([{ rows: [] }]);
    const res = await handleGetTool("nope", pool as any);
    expect(res.status).toBe(404);
  });

  it("200 with config_schema when found", async () => {
    const { pool } = makePool([
      { rows: [{ id: "t", slug: "fetch", title: "Fetch", protocol: "http", config_schema: {} }] },
    ]);
    const res = await handleGetTool("fetch", pool as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tool.slug).toBe("fetch");
  });
});

describe("handleCreateTool", () => {
  it("401 without internal token", async () => {
    process.env.HIVE_INTERNAL_TOKEN = "test-secret";
    const { pool } = makePool([]);
    const req = new Request("http://localhost/api/tools", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug: "x", title: "X", protocol: "mcp" }),
    });
    const res = await handleCreateTool(req, pool as any);
    expect(res.status).toBe(401);
  });

  it("400 when slug invalid", async () => {
    process.env.HIVE_INTERNAL_TOKEN = "test-secret";
    const { pool } = makePool([]);
    const req = new Request("http://localhost/api/tools", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Hive-Internal-Token": "test-secret",
      },
      body: JSON.stringify({ slug: "BAD SLUG", title: "X", protocol: "mcp" }),
    });
    const res = await handleCreateTool(req, pool as any);
    expect(res.status).toBe(400);
  });

  it("400 when protocol invalid", async () => {
    process.env.HIVE_INTERNAL_TOKEN = "test-secret";
    const { pool } = makePool([]);
    const req = new Request("http://localhost/api/tools", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Hive-Internal-Token": "test-secret",
      },
      body: JSON.stringify({ slug: "x", title: "X", protocol: "bogus" }),
    });
    const res = await handleCreateTool(req, pool as any);
    expect(res.status).toBe(400);
  });

  it("201 on valid payload", async () => {
    process.env.HIVE_INTERNAL_TOKEN = "test-secret";
    const { pool, calls } = makePool([
      {
        rows: [
          {
            id: TOOL_ID,
            slug: "fetch",
            title: "Fetch",
            protocol: "http",
            created_at: new Date(),
          },
        ],
      },
    ]);
    const req = new Request("http://localhost/api/tools", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Hive-Internal-Token": "test-secret",
      },
      body: JSON.stringify({ slug: "fetch", title: "Fetch", protocol: "http" }),
    });
    const res = await handleCreateTool(req, pool as any);
    expect(res.status).toBe(201);
    expect(calls[0].sql).toMatch(/INSERT INTO tools/);
  });

  it("409 on duplicate slug", async () => {
    process.env.HIVE_INTERNAL_TOKEN = "test-secret";
    const { pool } = makePool([{ reject: { code: "23505" } }]);
    const req = new Request("http://localhost/api/tools", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Hive-Internal-Token": "test-secret",
      },
      body: JSON.stringify({ slug: "fetch", title: "Fetch", protocol: "http" }),
    });
    const res = await handleCreateTool(req, pool as any);
    expect(res.status).toBe(409);
  });
});

describe("handleAttachTool", () => {
  it("401 without Authorization", async () => {
    const { pool } = makePool([]);
    const req = new Request(`http://localhost/api/agents/${AGENT_ID}/tools`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug: "fetch" }),
    });
    const res = await handleAttachTool(req, pool as any, AGENT_ID);
    expect(res.status).toBe(401);
  });

  it("403 when not owner", async () => {
    const { pool } = makePool([
      { rows: [{ id: AGENT_ID, builder_id: OWNER_ID }] },
    ]);
    const req = new Request(`http://localhost/api/agents/${AGENT_ID}/tools`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: otherToken() },
      body: JSON.stringify({ slug: "fetch" }),
    });
    const res = await handleAttachTool(req, pool as any, AGENT_ID);
    expect(res.status).toBe(403);
  });

  it("404 when tool slug unknown", async () => {
    const { pool } = makePool([
      { rows: [{ id: AGENT_ID, builder_id: OWNER_ID }] },
      { rows: [] },
    ]);
    const req = new Request(`http://localhost/api/agents/${AGENT_ID}/tools`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: ownerToken() },
      body: JSON.stringify({ slug: "missing" }),
    });
    const res = await handleAttachTool(req, pool as any, AGENT_ID);
    expect(res.status).toBe(404);
  });

  it("409 when already attached", async () => {
    const { pool } = makePool([
      { rows: [{ id: AGENT_ID, builder_id: OWNER_ID }] },
      { rows: [{ id: TOOL_ID }] },
      { reject: { code: "23505" } },
    ]);
    const req = new Request(`http://localhost/api/agents/${AGENT_ID}/tools`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: ownerToken() },
      body: JSON.stringify({ slug: "fetch" }),
    });
    const res = await handleAttachTool(req, pool as any, AGENT_ID);
    expect(res.status).toBe(409);
  });

  it("201 on successful attach", async () => {
    const { pool, calls } = makePool([
      { rows: [{ id: AGENT_ID, builder_id: OWNER_ID }] },
      { rows: [{ id: TOOL_ID }] },
      { rows: [{ agent_id: AGENT_ID, tool_id: TOOL_ID, attached_at: new Date() }] },
    ]);
    const req = new Request(`http://localhost/api/agents/${AGENT_ID}/tools`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: ownerToken() },
      body: JSON.stringify({ slug: "fetch" }),
    });
    const res = await handleAttachTool(req, pool as any, AGENT_ID);
    expect(res.status).toBe(201);
    expect(calls[2].sql).toMatch(/INSERT INTO agent_tools/);
  });
});

describe("handleDetachTool", () => {
  it("401 without Authorization", async () => {
    const { pool } = makePool([]);
    const req = new Request(
      `http://localhost/api/agents/${AGENT_ID}/tools/${TOOL_ID}`,
      { method: "DELETE" }
    );
    const res = await handleDetachTool(req, pool as any, AGENT_ID, TOOL_ID);
    expect(res.status).toBe(401);
  });

  it("403 when not owner", async () => {
    const { pool } = makePool([
      { rows: [{ id: AGENT_ID, builder_id: OWNER_ID }] },
    ]);
    const req = new Request(
      `http://localhost/api/agents/${AGENT_ID}/tools/${TOOL_ID}`,
      { method: "DELETE", headers: { Authorization: otherToken() } }
    );
    const res = await handleDetachTool(req, pool as any, AGENT_ID, TOOL_ID);
    expect(res.status).toBe(403);
  });

  it("404 when attachment not found", async () => {
    const { pool } = makePool([
      { rows: [{ id: AGENT_ID, builder_id: OWNER_ID }] },
      { rows: [] },
    ]);
    const req = new Request(
      `http://localhost/api/agents/${AGENT_ID}/tools/${TOOL_ID}`,
      { method: "DELETE", headers: { Authorization: ownerToken() } }
    );
    const res = await handleDetachTool(req, pool as any, AGENT_ID, TOOL_ID);
    expect(res.status).toBe(404);
  });

  it("204 on successful detach", async () => {
    const { pool, calls } = makePool([
      { rows: [{ id: AGENT_ID, builder_id: OWNER_ID }] },
      { rows: [{ agent_id: AGENT_ID }] },
    ]);
    const req = new Request(
      `http://localhost/api/agents/${AGENT_ID}/tools/${TOOL_ID}`,
      { method: "DELETE", headers: { Authorization: ownerToken() } }
    );
    const res = await handleDetachTool(req, pool as any, AGENT_ID, TOOL_ID);
    expect(res.status).toBe(204);
    expect(calls[1].sql).toMatch(/DELETE FROM agent_tools/);
  });
});

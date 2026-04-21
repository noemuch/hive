import { describe, it, expect, mock } from "bun:test";
import {
  handleListSkills,
  handleGetSkill,
  handleCreateSkill,
  handleAttachSkill,
  handleDetachSkill,
} from "./skills";
import { createBuilderToken } from "../auth/index";

const OWNER_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_BUILDER_ID = "22222222-2222-2222-2222-222222222222";
const AGENT_ID = "33333333-3333-3333-3333-333333333333";
const SKILL_ID = "66666666-6666-6666-6666-666666666666";

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

describe("handleListSkills", () => {
  it("returns all skills when no filter given", async () => {
    const { pool } = makePool([
      {
        rows: [
          { id: "a", slug: "tdd", title: "TDD", description: null, category: "dev", version: "1.0" },
        ],
      },
    ]);
    const res = await handleListSkills(new URL("http://localhost/api/skills"), pool as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.skills).toHaveLength(1);
    expect(body.skills[0].slug).toBe("tdd");
    expect(body.skills[0]).not.toHaveProperty("content_md");
  });

  it("passes category filter as parameter", async () => {
    const { pool, calls } = makePool([{ rows: [] }]);
    await handleListSkills(
      new URL("http://localhost/api/skills?category=adversarial_skill"),
      pool as any
    );
    expect(calls[0].params).toContain("adversarial_skill");
  });

  it("passes q filter as LIKE parameter", async () => {
    const { pool, calls } = makePool([{ rows: [] }]);
    await handleListSkills(new URL("http://localhost/api/skills?q=red"), pool as any);
    expect(calls[0].params.some((p) => typeof p === "string" && p.includes("red"))).toBe(true);
  });
});

describe("handleGetSkill", () => {
  it("returns 400 for invalid slug", async () => {
    const { pool } = makePool([]);
    const res = await handleGetSkill("BAD SLUG", pool as any);
    expect(res.status).toBe(400);
  });

  it("returns 404 when slug does not exist", async () => {
    const { pool } = makePool([{ rows: [] }]);
    const res = await handleGetSkill("missing-skill", pool as any);
    expect(res.status).toBe(404);
  });

  it("returns skill with content_md", async () => {
    const { pool } = makePool([
      {
        rows: [
          {
            id: "a",
            slug: "tdd",
            title: "TDD",
            description: null,
            category: "dev",
            version: "1.0",
            source_url: null,
            content_md: "# TDD\n...",
            created_at: new Date(),
          },
        ],
      },
    ]);
    const res = await handleGetSkill("tdd", pool as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.skill.slug).toBe("tdd");
    expect(body.skill.content_md).toBe("# TDD\n...");
  });
});

describe("handleCreateSkill", () => {
  it("returns 401 without internal token", async () => {
    process.env.HIVE_INTERNAL_TOKEN = "test-secret";
    const { pool } = makePool([]);
    const req = new Request("http://localhost/api/skills", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug: "x", title: "X" }),
    });
    const res = await handleCreateSkill(req, pool as any);
    expect(res.status).toBe(401);
  });

  it("returns 401 when token mismatches", async () => {
    process.env.HIVE_INTERNAL_TOKEN = "test-secret";
    const { pool } = makePool([]);
    const req = new Request("http://localhost/api/skills", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Hive-Internal-Token": "wrong",
      },
      body: JSON.stringify({ slug: "x", title: "X" }),
    });
    const res = await handleCreateSkill(req, pool as any);
    expect(res.status).toBe(401);
  });

  it("returns 400 for invalid slug", async () => {
    process.env.HIVE_INTERNAL_TOKEN = "test-secret";
    const { pool } = makePool([]);
    const req = new Request("http://localhost/api/skills", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Hive-Internal-Token": "test-secret",
      },
      body: JSON.stringify({ slug: "BAD SLUG", title: "X" }),
    });
    const res = await handleCreateSkill(req, pool as any);
    expect(res.status).toBe(400);
  });

  it("returns 400 when title is missing", async () => {
    process.env.HIVE_INTERNAL_TOKEN = "test-secret";
    const { pool } = makePool([]);
    const req = new Request("http://localhost/api/skills", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Hive-Internal-Token": "test-secret",
      },
      body: JSON.stringify({ slug: "red-team" }),
    });
    const res = await handleCreateSkill(req, pool as any);
    expect(res.status).toBe(400);
  });

  it("returns 201 and inserts on valid payload", async () => {
    process.env.HIVE_INTERNAL_TOKEN = "test-secret";
    const { pool, calls } = makePool([
      {
        rows: [
          {
            id: "55555555-5555-5555-5555-555555555555",
            slug: "red-team",
            title: "Red Team",
            created_at: new Date(),
          },
        ],
      },
    ]);
    const req = new Request("http://localhost/api/skills", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Hive-Internal-Token": "test-secret",
      },
      body: JSON.stringify({
        slug: "red-team",
        title: "Red Team",
        category: "adversarial_skill",
        version: "1.0.0",
      }),
    });
    const res = await handleCreateSkill(req, pool as any);
    expect(res.status).toBe(201);
    expect(calls[0].sql).toMatch(/INSERT INTO skills/);
  });

  it("returns 409 when slug already exists", async () => {
    process.env.HIVE_INTERNAL_TOKEN = "test-secret";
    const { pool } = makePool([{ reject: { code: "23505" } }]);
    const req = new Request("http://localhost/api/skills", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Hive-Internal-Token": "test-secret",
      },
      body: JSON.stringify({ slug: "red-team", title: "Red Team" }),
    });
    const res = await handleCreateSkill(req, pool as any);
    expect(res.status).toBe(409);
  });
});

describe("handleAttachSkill", () => {
  it("returns 401 without Authorization header", async () => {
    const { pool } = makePool([]);
    const req = new Request(`http://localhost/api/agents/${AGENT_ID}/skills`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug: "tdd" }),
    });
    const res = await handleAttachSkill(req, pool as any, AGENT_ID);
    expect(res.status).toBe(401);
  });

  it("returns 404 when agent does not exist", async () => {
    const { pool } = makePool([{ rows: [] }]);
    const req = new Request(`http://localhost/api/agents/${AGENT_ID}/skills`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: ownerToken() },
      body: JSON.stringify({ slug: "tdd" }),
    });
    const res = await handleAttachSkill(req, pool as any, AGENT_ID);
    expect(res.status).toBe(404);
  });

  it("returns 403 when caller is not the agent owner", async () => {
    const { pool } = makePool([
      { rows: [{ id: AGENT_ID, builder_id: OWNER_ID }] },
    ]);
    const req = new Request(`http://localhost/api/agents/${AGENT_ID}/skills`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: otherToken() },
      body: JSON.stringify({ slug: "tdd" }),
    });
    const res = await handleAttachSkill(req, pool as any, AGENT_ID);
    expect(res.status).toBe(403);
  });

  it("returns 400 when slug missing", async () => {
    const { pool } = makePool([
      { rows: [{ id: AGENT_ID, builder_id: OWNER_ID }] },
    ]);
    const req = new Request(`http://localhost/api/agents/${AGENT_ID}/skills`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: ownerToken() },
      body: JSON.stringify({}),
    });
    const res = await handleAttachSkill(req, pool as any, AGENT_ID);
    expect(res.status).toBe(400);
  });

  it("returns 404 when skill slug unknown", async () => {
    const { pool } = makePool([
      { rows: [{ id: AGENT_ID, builder_id: OWNER_ID }] },
      { rows: [] },
    ]);
    const req = new Request(`http://localhost/api/agents/${AGENT_ID}/skills`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: ownerToken() },
      body: JSON.stringify({ slug: "missing" }),
    });
    const res = await handleAttachSkill(req, pool as any, AGENT_ID);
    expect(res.status).toBe(404);
  });

  it("returns 409 when skill already attached", async () => {
    const { pool } = makePool([
      { rows: [{ id: AGENT_ID, builder_id: OWNER_ID }] },
      { rows: [{ id: SKILL_ID }] },
      { reject: { code: "23505" } },
    ]);
    const req = new Request(`http://localhost/api/agents/${AGENT_ID}/skills`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: ownerToken() },
      body: JSON.stringify({ slug: "tdd" }),
    });
    const res = await handleAttachSkill(req, pool as any, AGENT_ID);
    expect(res.status).toBe(409);
  });

  it("returns 201 on successful attach", async () => {
    const { pool, calls } = makePool([
      { rows: [{ id: AGENT_ID, builder_id: OWNER_ID }] },
      { rows: [{ id: SKILL_ID }] },
      { rows: [{ agent_id: AGENT_ID, skill_id: SKILL_ID, attached_at: new Date() }] },
    ]);
    const req = new Request(`http://localhost/api/agents/${AGENT_ID}/skills`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: ownerToken() },
      body: JSON.stringify({ slug: "tdd" }),
    });
    const res = await handleAttachSkill(req, pool as any, AGENT_ID);
    expect(res.status).toBe(201);
    expect(calls[2].sql).toMatch(/INSERT INTO agent_skills/);
  });
});

describe("handleDetachSkill", () => {
  it("returns 401 without Authorization", async () => {
    const { pool } = makePool([]);
    const req = new Request(
      `http://localhost/api/agents/${AGENT_ID}/skills/${SKILL_ID}`,
      { method: "DELETE" }
    );
    const res = await handleDetachSkill(req, pool as any, AGENT_ID, SKILL_ID);
    expect(res.status).toBe(401);
  });

  it("returns 403 when caller is not the agent owner", async () => {
    const { pool } = makePool([
      { rows: [{ id: AGENT_ID, builder_id: OWNER_ID }] },
    ]);
    const req = new Request(
      `http://localhost/api/agents/${AGENT_ID}/skills/${SKILL_ID}`,
      { method: "DELETE", headers: { Authorization: otherToken() } }
    );
    const res = await handleDetachSkill(req, pool as any, AGENT_ID, SKILL_ID);
    expect(res.status).toBe(403);
  });

  it("returns 404 when attachment not found (affects 0 rows)", async () => {
    const { pool } = makePool([
      { rows: [{ id: AGENT_ID, builder_id: OWNER_ID }] },
      { rows: [] },
    ]);
    const req = new Request(
      `http://localhost/api/agents/${AGENT_ID}/skills/${SKILL_ID}`,
      { method: "DELETE", headers: { Authorization: ownerToken() } }
    );
    const res = await handleDetachSkill(req, pool as any, AGENT_ID, SKILL_ID);
    expect(res.status).toBe(404);
  });

  it("returns 204 on successful detach", async () => {
    const { pool, calls } = makePool([
      { rows: [{ id: AGENT_ID, builder_id: OWNER_ID }] },
      { rows: [{ agent_id: AGENT_ID, skill_id: SKILL_ID }] },
    ]);
    const req = new Request(
      `http://localhost/api/agents/${AGENT_ID}/skills/${SKILL_ID}`,
      { method: "DELETE", headers: { Authorization: ownerToken() } }
    );
    const res = await handleDetachSkill(req, pool as any, AGENT_ID, SKILL_ID);
    expect(res.status).toBe(204);
    expect(calls[1].sql).toMatch(/DELETE FROM agent_skills/);
  });
});

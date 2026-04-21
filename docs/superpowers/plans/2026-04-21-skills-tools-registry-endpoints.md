# Skills + Tools Registry Endpoints Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship 8 REST endpoints to browse the skills/tools registries and attach/detach them to agents (owner-only), backed by the #214 `skills` / `agent_skills` / `tools` / `agent_tools` tables.

**Architecture:** Two new handler modules (`skills.ts`, `tools.ts`) symmetric in shape. Each exports list / get-by-slug / attach / detach / (admin) create. Owner-check reused from `agent-hires.ts` pattern (JWT → load agent → compare `builder_id`). Admin writes gated by `HIVE_INTERNAL_TOKEN` (same shared-secret pattern as `/api/internal/*`) — no new tier/role introduced for initial launch. Pagination/filter parsing reuses conventions from `marketplace.ts`.

**Tech Stack:** Bun + TypeScript + `pg` raw SQL (parameterized). Tests: `bun:test` with a scripted mock pool (same pattern as `agent-hires.test.ts`).

**Scope notes:**
- #214 (migration 032) is already MERGED — tables exist. No new migration needed.
- Admin `POST` endpoints use `X-Hive-Internal-Token` (matches `/api/internal/quality/*` convention) because the codebase has no admin tier today. Builder-contributed writes are explicitly out of scope per issue body ("admin only initially, later builder-contributed").
- No caching layer — these registries are small (< 50 rows expected) and mutation-rare. Can add `marketplaceCache.wrap` later if needed.

---

## File Structure

**Create:**
- `server/src/handlers/skills.ts` — list / get / create / attach / detach for skills
- `server/src/handlers/tools.ts` — list / get / create / attach / detach for tools
- `server/src/handlers/skills.test.ts` — unit tests with mock pool
- `server/src/handlers/tools.test.ts` — unit tests with mock pool

**Modify:**
- `server/src/index.ts` — import + wire 8 new routes

---

## Task 1: Skills handler — types + shared auth helpers

**Files:**
- Create: `server/src/handlers/skills.ts`

- [ ] **Step 1: Scaffold the module with shared helpers**

Create `server/src/handlers/skills.ts`:

```ts
import type { Pool } from "pg";
import { timingSafeEqual } from "node:crypto";
import { json } from "../http/response";
import { verifyBuilderToken } from "../auth/index";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

type AuthResult =
  | { ok: true; builderId: string }
  | { ok: false; response: Response };

function authenticateBuilder(req: Request): AuthResult {
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) {
    return {
      ok: false,
      response: json({ error: "auth_required", message: "Authorization header required" }, 401),
    };
  }
  const decoded = verifyBuilderToken(auth.slice(7));
  if (!decoded) {
    return {
      ok: false,
      response: json({ error: "invalid_token", message: "Invalid or expired token" }, 401),
    };
  }
  return { ok: true, builderId: decoded.builder_id };
}

function verifyInternalToken(req: Request): Response | null {
  const expected = process.env.HIVE_INTERNAL_TOKEN;
  if (!expected) {
    console.error("[skills] HIVE_INTERNAL_TOKEN not configured");
    return json({ error: "internal_not_configured" }, 500);
  }
  const provided = req.headers.get("X-Hive-Internal-Token");
  if (!provided) return json({ error: "unauthorized", message: "Unauthorized" }, 401);
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return json({ error: "unauthorized", message: "Unauthorized" }, 401);
  }
  return null;
}

async function loadOwnedAgent(
  pool: Pool,
  agentId: string,
  builderId: string
): Promise<{ ok: true } | { ok: false; response: Response }> {
  if (!UUID_RE.test(agentId)) {
    return { ok: false, response: json({ error: "not_found", message: "Agent not found" }, 404) };
  }
  const { rows } = await pool.query(
    `SELECT id, builder_id FROM agents WHERE id = $1`,
    [agentId]
  );
  if (rows.length === 0) {
    return { ok: false, response: json({ error: "not_found", message: "Agent not found" }, 404) };
  }
  if (rows[0].builder_id !== builderId) {
    return { ok: false, response: json({ error: "forbidden", message: "Not your agent" }, 403) };
  }
  return { ok: true };
}

function clampLimit(raw: string | null): number {
  if (!raw) return DEFAULT_LIMIT;
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

function clampOffset(raw: string | null): number {
  if (!raw) return 0;
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}
```

- [ ] **Step 2: Commit**

```bash
git add server/src/handlers/skills.ts
git commit -m "feat(api): scaffold skills handler module (#215)"
```

---

## Task 2: `GET /api/skills` — list + filter

**Files:**
- Modify: `server/src/handlers/skills.ts`
- Create: `server/src/handlers/skills.test.ts`

- [ ] **Step 1: Write the failing test**

Create `server/src/handlers/skills.test.ts`:

```ts
import { describe, it, expect, mock } from "bun:test";
import { handleListSkills } from "./skills";

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

describe("handleListSkills", () => {
  it("returns all skills when no filter given", async () => {
    const { pool } = makePool([
      {
        rows: [
          { id: "a", slug: "tdd", title: "TDD", description: null, category: "dev", version: "1.0" },
        ],
      },
    ]);
    const res = await handleListSkills(
      new URL("http://localhost/api/skills"),
      pool as any
    );
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
});
```

- [ ] **Step 2: Run test, verify it fails with "handleListSkills not exported"**

Run: `bun test server/src/handlers/skills.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement handleListSkills**

Append to `server/src/handlers/skills.ts`:

```ts
export async function handleListSkills(url: URL, pool: Pool): Promise<Response> {
  const qRaw = (url.searchParams.get("q") ?? "").trim();
  const category = (url.searchParams.get("category") ?? "").trim();
  const limit = clampLimit(url.searchParams.get("limit"));
  const offset = clampOffset(url.searchParams.get("offset"));

  const clauses: string[] = [];
  const params: unknown[] = [];
  if (category.length > 0) {
    params.push(category);
    clauses.push(`category = $${params.length}`);
  }
  if (qRaw.length > 0) {
    params.push(`%${qRaw}%`);
    clauses.push(`(title ILIKE $${params.length} OR slug ILIKE $${params.length})`);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  params.push(limit);
  params.push(offset);

  const { rows } = await pool.query(
    `SELECT id, slug, title, description, category, version, source_url, created_at
     FROM skills
     ${where}
     ORDER BY created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return json({ skills: rows, limit, offset });
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `bun test server/src/handlers/skills.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/handlers/skills.ts server/src/handlers/skills.test.ts
git commit -m "feat(api): GET /api/skills list+filter (#215)"
```

---

## Task 3: `GET /api/skills/:slug` — single skill w/ content_md

**Files:**
- Modify: `server/src/handlers/skills.ts`
- Modify: `server/src/handlers/skills.test.ts`

- [ ] **Step 1: Add failing test**

Append to `skills.test.ts`:

```ts
import { handleGetSkill } from "./skills";

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
```

- [ ] **Step 2: Run test, verify failure (handleGetSkill not exported)**

Run: `bun test server/src/handlers/skills.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement handleGetSkill**

Append to `skills.ts`:

```ts
export async function handleGetSkill(slug: string, pool: Pool): Promise<Response> {
  if (!SLUG_RE.test(slug)) {
    return json({ error: "validation_error", message: "Invalid slug" }, 400);
  }
  const { rows } = await pool.query(
    `SELECT id, slug, title, description, category, version, source_url, content_md, created_at
     FROM skills
     WHERE slug = $1`,
    [slug]
  );
  if (rows.length === 0) {
    return json({ error: "not_found", message: "Skill not found" }, 404);
  }
  return json({ skill: rows[0] });
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `bun test server/src/handlers/skills.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/handlers/skills.ts server/src/handlers/skills.test.ts
git commit -m "feat(api): GET /api/skills/:slug (#215)"
```

---

## Task 4: `POST /api/skills` — admin create

**Files:**
- Modify: `server/src/handlers/skills.ts`
- Modify: `server/src/handlers/skills.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `skills.test.ts`:

```ts
import { handleCreateSkill } from "./skills";

describe("handleCreateSkill", () => {
  it("returns 401 without internal token", async () => {
    const { pool } = makePool([]);
    const req = new Request("http://localhost/api/skills", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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

  it("returns 201 and inserts on valid payload", async () => {
    process.env.HIVE_INTERNAL_TOKEN = "test-secret";
    const { pool, calls } = makePool([
      { rows: [{ id: "55555555-5555-5555-5555-555555555555", created_at: new Date() }] },
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
});
```

- [ ] **Step 2: Run tests, verify failure**

Run: `bun test server/src/handlers/skills.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement handleCreateSkill**

Append to `skills.ts`:

```ts
const MAX_TITLE_LENGTH = 128;
const MAX_DESCRIPTION_LENGTH = 2000;
const MAX_VERSION_LENGTH = 32;
const MAX_CATEGORY_LENGTH = 64;
const MAX_URL_LENGTH = 512;
const MAX_CONTENT_MD_LENGTH = 500_000;

export async function handleCreateSkill(req: Request, pool: Pool): Promise<Response> {
  const unauthorized = verifyInternalToken(req);
  if (unauthorized) return unauthorized;

  const body = await req.json().catch(() => null) as {
    slug?: unknown;
    title?: unknown;
    description?: unknown;
    category?: unknown;
    version?: unknown;
    source_url?: unknown;
    content_md?: unknown;
  } | null;
  if (!body || typeof body !== "object") {
    return json({ error: "validation_error", message: "JSON body required" }, 400);
  }

  const slug = typeof body.slug === "string" ? body.slug.trim().toLowerCase() : "";
  if (!SLUG_RE.test(slug)) {
    return json({ error: "validation_error", message: "Invalid slug" }, 400);
  }
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (title.length < 1 || title.length > MAX_TITLE_LENGTH) {
    return json(
      { error: "validation_error", message: `title must be 1-${MAX_TITLE_LENGTH} chars` },
      400
    );
  }
  const description = typeof body.description === "string"
    ? body.description.slice(0, MAX_DESCRIPTION_LENGTH)
    : null;
  const category = typeof body.category === "string"
    ? body.category.trim().slice(0, MAX_CATEGORY_LENGTH)
    : null;
  const version = typeof body.version === "string"
    ? body.version.trim().slice(0, MAX_VERSION_LENGTH)
    : null;
  const sourceUrl = typeof body.source_url === "string"
    ? body.source_url.trim().slice(0, MAX_URL_LENGTH)
    : null;
  const contentMd = typeof body.content_md === "string"
    ? body.content_md.slice(0, MAX_CONTENT_MD_LENGTH)
    : null;

  try {
    const { rows } = await pool.query(
      `INSERT INTO skills (slug, title, description, category, version, source_url, content_md)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, slug, title, created_at`,
      [slug, title, description, category, version, sourceUrl, contentMd]
    );
    return json({ skill: rows[0] }, 201);
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code === "23505") {
      return json({ error: "conflict", message: "Slug already exists" }, 409);
    }
    throw err;
  }
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `bun test server/src/handlers/skills.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/handlers/skills.ts server/src/handlers/skills.test.ts
git commit -m "feat(api): POST /api/skills admin create (#215)"
```

---

## Task 5: `POST /api/agents/:id/skills` — owner attach

**Files:**
- Modify: `server/src/handlers/skills.ts`
- Modify: `server/src/handlers/skills.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `skills.test.ts`:

```ts
import { handleAttachSkill } from "./skills";
import { createBuilderToken } from "../auth/index";

const OWNER_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_BUILDER_ID = "22222222-2222-2222-2222-222222222222";
const AGENT_ID = "33333333-3333-3333-3333-333333333333";
const SKILL_ID = "66666666-6666-6666-6666-666666666666";

function ownerToken(): string { return `Bearer ${createBuilderToken(OWNER_ID)}`; }
function otherToken(): string { return `Bearer ${createBuilderToken(OTHER_BUILDER_ID)}`; }

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

  it("returns 409 when skill already attached (PK conflict)", async () => {
    const { pool } = makePool([
      { rows: [{ id: AGENT_ID, builder_id: OWNER_ID }] },
      { rows: [{ id: SKILL_ID }] },
      Promise.reject(Object.assign(new Error("dup"), { code: "23505" })) as any,
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
```

- [ ] **Step 2: Run tests, verify failure**

Run: `bun test server/src/handlers/skills.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement**

Also update `makePool` in `skills.test.ts` to support rejecting promises (see test — we pass a rejecting Promise as a step; update the factory to detect it):

```ts
function makePool(steps: Array<{ rows: unknown[] } | Promise<never>>) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  let i = 0;
  const pool = {
    query: mock(async (sql: string, params: unknown[]) => {
      calls.push({ sql, params });
      const step = steps[i++];
      if (!step) throw new Error(`unexpected query #${i}: ${sql.slice(0, 60)}`);
      return await step;
    }),
  };
  return { pool, calls };
}
```

Append to `skills.ts`:

```ts
export async function handleAttachSkill(
  req: Request,
  pool: Pool,
  agentId: string
): Promise<Response> {
  const auth = authenticateBuilder(req);
  if (!auth.ok) return auth.response;

  const ownership = await loadOwnedAgent(pool, agentId, auth.builderId);
  if (!ownership.ok) return ownership.response;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return json({ error: "validation_error", message: "JSON body required" }, 400);
  }
  const slug = typeof body.slug === "string" ? body.slug.trim().toLowerCase() : "";
  if (!SLUG_RE.test(slug)) {
    return json({ error: "validation_error", message: "slug required" }, 400);
  }

  const { rows: skillRows } = await pool.query(
    `SELECT id FROM skills WHERE slug = $1`,
    [slug]
  );
  if (skillRows.length === 0) {
    return json({ error: "not_found", message: "Skill not found" }, 404);
  }
  const skillId = skillRows[0].id;

  try {
    const { rows } = await pool.query(
      `INSERT INTO agent_skills (agent_id, skill_id)
       VALUES ($1, $2)
       RETURNING agent_id, skill_id, attached_at`,
      [agentId, skillId]
    );
    return json({ attachment: rows[0] }, 201);
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code === "23505") {
      return json({ error: "conflict", message: "Skill already attached" }, 409);
    }
    throw err;
  }
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `bun test server/src/handlers/skills.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/handlers/skills.ts server/src/handlers/skills.test.ts
git commit -m "feat(api): POST /api/agents/:id/skills (#215)"
```

---

## Task 6: `DELETE /api/agents/:id/skills/:skill_id` — owner detach

**Files:**
- Modify: `server/src/handlers/skills.ts`
- Modify: `server/src/handlers/skills.test.ts`

- [ ] **Step 1: Add failing test**

Append to `skills.test.ts`:

```ts
import { handleDetachSkill } from "./skills";

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
```

- [ ] **Step 2: Run test, verify failure**

- [ ] **Step 3: Implement**

Append to `skills.ts`:

```ts
export async function handleDetachSkill(
  req: Request,
  pool: Pool,
  agentId: string,
  skillId: string
): Promise<Response> {
  const auth = authenticateBuilder(req);
  if (!auth.ok) return auth.response;

  const ownership = await loadOwnedAgent(pool, agentId, auth.builderId);
  if (!ownership.ok) return ownership.response;

  if (!UUID_RE.test(skillId)) {
    return json({ error: "not_found", message: "Skill attachment not found" }, 404);
  }

  const { rows } = await pool.query(
    `DELETE FROM agent_skills
     WHERE agent_id = $1 AND skill_id = $2
     RETURNING agent_id`,
    [agentId, skillId]
  );
  if (rows.length === 0) {
    return json({ error: "not_found", message: "Skill attachment not found" }, 404);
  }
  return new Response(null, {
    status: 204,
    headers: { "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN || "*" },
  });
}
```

- [ ] **Step 4: Run tests, verify pass**

- [ ] **Step 5: Commit**

```bash
git add server/src/handlers/skills.ts server/src/handlers/skills.test.ts
git commit -m "feat(api): DELETE /api/agents/:id/skills/:skill_id (#215)"
```

---

## Task 7: Tools handler — same 5 endpoints, `protocol` required

**Files:**
- Create: `server/src/handlers/tools.ts`
- Create: `server/src/handlers/tools.test.ts`

Same 5 endpoints as skills, symmetric. Differences:
- `tools.protocol` is NOT NULL + CHECK — must validate against `{mcp,http,websocket,native}`.
- `tools` has `config_schema jsonb` (accept as an optional JSON object on POST).
- No `version` / `source_url` / `content_md` fields on tools.

- [ ] **Step 1: Port `skills.ts` structure with the above deltas**

Full file (write in one shot — shares no code with skills.ts to keep modules independent):

```ts
import type { Pool } from "pg";
import { timingSafeEqual } from "node:crypto";
import { json } from "../http/response";
import { verifyBuilderToken } from "../auth/index";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const VALID_PROTOCOLS = ["mcp", "http", "websocket", "native"] as const;
type Protocol = typeof VALID_PROTOCOLS[number];

const MAX_TITLE_LENGTH = 128;
const MAX_DESCRIPTION_LENGTH = 2000;
const MAX_CATEGORY_LENGTH = 64;

type AuthResult =
  | { ok: true; builderId: string }
  | { ok: false; response: Response };

function authenticateBuilder(req: Request): AuthResult {
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) {
    return {
      ok: false,
      response: json({ error: "auth_required", message: "Authorization header required" }, 401),
    };
  }
  const decoded = verifyBuilderToken(auth.slice(7));
  if (!decoded) {
    return {
      ok: false,
      response: json({ error: "invalid_token", message: "Invalid or expired token" }, 401),
    };
  }
  return { ok: true, builderId: decoded.builder_id };
}

function verifyInternalToken(req: Request): Response | null {
  const expected = process.env.HIVE_INTERNAL_TOKEN;
  if (!expected) {
    console.error("[tools] HIVE_INTERNAL_TOKEN not configured");
    return json({ error: "internal_not_configured" }, 500);
  }
  const provided = req.headers.get("X-Hive-Internal-Token");
  if (!provided) return json({ error: "unauthorized", message: "Unauthorized" }, 401);
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return json({ error: "unauthorized", message: "Unauthorized" }, 401);
  }
  return null;
}

async function loadOwnedAgent(
  pool: Pool,
  agentId: string,
  builderId: string
): Promise<{ ok: true } | { ok: false; response: Response }> {
  if (!UUID_RE.test(agentId)) {
    return { ok: false, response: json({ error: "not_found", message: "Agent not found" }, 404) };
  }
  const { rows } = await pool.query(
    `SELECT id, builder_id FROM agents WHERE id = $1`,
    [agentId]
  );
  if (rows.length === 0) {
    return { ok: false, response: json({ error: "not_found", message: "Agent not found" }, 404) };
  }
  if (rows[0].builder_id !== builderId) {
    return { ok: false, response: json({ error: "forbidden", message: "Not your agent" }, 403) };
  }
  return { ok: true };
}

function clampLimit(raw: string | null): number {
  if (!raw) return DEFAULT_LIMIT;
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

function clampOffset(raw: string | null): number {
  if (!raw) return 0;
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export async function handleListTools(url: URL, pool: Pool): Promise<Response> {
  const qRaw = (url.searchParams.get("q") ?? "").trim();
  const category = (url.searchParams.get("category") ?? "").trim();
  const protocolRaw = (url.searchParams.get("protocol") ?? "").trim().toLowerCase();
  const limit = clampLimit(url.searchParams.get("limit"));
  const offset = clampOffset(url.searchParams.get("offset"));

  const clauses: string[] = [];
  const params: unknown[] = [];
  if (category.length > 0) {
    params.push(category);
    clauses.push(`category = $${params.length}`);
  }
  if ((VALID_PROTOCOLS as readonly string[]).includes(protocolRaw)) {
    params.push(protocolRaw);
    clauses.push(`protocol = $${params.length}`);
  }
  if (qRaw.length > 0) {
    params.push(`%${qRaw}%`);
    clauses.push(`(title ILIKE $${params.length} OR slug ILIKE $${params.length})`);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  params.push(limit);
  params.push(offset);

  const { rows } = await pool.query(
    `SELECT id, slug, title, description, category, protocol, created_at
     FROM tools
     ${where}
     ORDER BY created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return json({ tools: rows, limit, offset });
}

export async function handleGetTool(slug: string, pool: Pool): Promise<Response> {
  if (!SLUG_RE.test(slug)) {
    return json({ error: "validation_error", message: "Invalid slug" }, 400);
  }
  const { rows } = await pool.query(
    `SELECT id, slug, title, description, category, protocol, config_schema, created_at
     FROM tools
     WHERE slug = $1`,
    [slug]
  );
  if (rows.length === 0) {
    return json({ error: "not_found", message: "Tool not found" }, 404);
  }
  return json({ tool: rows[0] });
}

export async function handleCreateTool(req: Request, pool: Pool): Promise<Response> {
  const unauthorized = verifyInternalToken(req);
  if (unauthorized) return unauthorized;

  const body = await req.json().catch(() => null) as {
    slug?: unknown;
    title?: unknown;
    description?: unknown;
    category?: unknown;
    protocol?: unknown;
    config_schema?: unknown;
  } | null;
  if (!body || typeof body !== "object") {
    return json({ error: "validation_error", message: "JSON body required" }, 400);
  }

  const slug = typeof body.slug === "string" ? body.slug.trim().toLowerCase() : "";
  if (!SLUG_RE.test(slug)) {
    return json({ error: "validation_error", message: "Invalid slug" }, 400);
  }
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (title.length < 1 || title.length > MAX_TITLE_LENGTH) {
    return json(
      { error: "validation_error", message: `title must be 1-${MAX_TITLE_LENGTH} chars` },
      400
    );
  }
  const protocolRaw = typeof body.protocol === "string" ? body.protocol.trim().toLowerCase() : "";
  if (!(VALID_PROTOCOLS as readonly string[]).includes(protocolRaw)) {
    return json(
      { error: "validation_error", message: `protocol must be one of ${VALID_PROTOCOLS.join(", ")}` },
      400
    );
  }
  const protocol = protocolRaw as Protocol;
  const description = typeof body.description === "string"
    ? body.description.slice(0, MAX_DESCRIPTION_LENGTH)
    : null;
  const category = typeof body.category === "string"
    ? body.category.trim().slice(0, MAX_CATEGORY_LENGTH)
    : null;
  const configSchema =
    body.config_schema !== undefined && body.config_schema !== null
      ? JSON.stringify(body.config_schema)
      : null;

  try {
    const { rows } = await pool.query(
      `INSERT INTO tools (slug, title, description, category, protocol, config_schema)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)
       RETURNING id, slug, title, protocol, created_at`,
      [slug, title, description, category, protocol, configSchema]
    );
    return json({ tool: rows[0] }, 201);
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code === "23505") {
      return json({ error: "conflict", message: "Slug already exists" }, 409);
    }
    throw err;
  }
}

export async function handleAttachTool(
  req: Request,
  pool: Pool,
  agentId: string
): Promise<Response> {
  const auth = authenticateBuilder(req);
  if (!auth.ok) return auth.response;

  const ownership = await loadOwnedAgent(pool, agentId, auth.builderId);
  if (!ownership.ok) return ownership.response;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return json({ error: "validation_error", message: "JSON body required" }, 400);
  }
  const slug = typeof body.slug === "string" ? body.slug.trim().toLowerCase() : "";
  if (!SLUG_RE.test(slug)) {
    return json({ error: "validation_error", message: "slug required" }, 400);
  }

  const { rows: toolRows } = await pool.query(
    `SELECT id FROM tools WHERE slug = $1`,
    [slug]
  );
  if (toolRows.length === 0) {
    return json({ error: "not_found", message: "Tool not found" }, 404);
  }
  const toolId = toolRows[0].id;

  try {
    const { rows } = await pool.query(
      `INSERT INTO agent_tools (agent_id, tool_id)
       VALUES ($1, $2)
       RETURNING agent_id, tool_id, attached_at`,
      [agentId, toolId]
    );
    return json({ attachment: rows[0] }, 201);
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code === "23505") {
      return json({ error: "conflict", message: "Tool already attached" }, 409);
    }
    throw err;
  }
}

export async function handleDetachTool(
  req: Request,
  pool: Pool,
  agentId: string,
  toolId: string
): Promise<Response> {
  const auth = authenticateBuilder(req);
  if (!auth.ok) return auth.response;

  const ownership = await loadOwnedAgent(pool, agentId, auth.builderId);
  if (!ownership.ok) return ownership.response;

  if (!UUID_RE.test(toolId)) {
    return json({ error: "not_found", message: "Tool attachment not found" }, 404);
  }

  const { rows } = await pool.query(
    `DELETE FROM agent_tools
     WHERE agent_id = $1 AND tool_id = $2
     RETURNING agent_id`,
    [agentId, toolId]
  );
  if (rows.length === 0) {
    return json({ error: "not_found", message: "Tool attachment not found" }, 404);
  }
  return new Response(null, {
    status: 204,
    headers: { "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN || "*" },
  });
}
```

- [ ] **Step 2: Write tests** — port `skills.test.ts` 1:1 with tools names + test `protocol` validation branch.

```ts
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

function makePool(steps: Array<{ rows: unknown[] } | Promise<never>>) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  let i = 0;
  const pool = {
    query: mock(async (sql: string, params: unknown[]) => {
      calls.push({ sql, params });
      const step = steps[i++];
      if (!step) throw new Error(`unexpected query #${i}: ${sql.slice(0, 60)}`);
      return await step;
    }),
  };
  return { pool, calls };
}

describe("handleListTools", () => {
  it("returns 200 with rows", async () => {
    const { pool } = makePool([{ rows: [{ id: "t", slug: "fetch", title: "Fetch", protocol: "http" }] }]);
    const res = await handleListTools(new URL("http://localhost/api/tools"), pool as any);
    expect(res.status).toBe(200);
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
});

describe("handleGetTool", () => {
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
  });
});

describe("handleCreateTool", () => {
  it("401 without internal token", async () => {
    const { pool } = makePool([]);
    const req = new Request("http://localhost/api/tools", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug: "x", title: "X", protocol: "mcp" }),
    });
    const res = await handleCreateTool(req, pool as any);
    expect(res.status).toBe(401);
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
    const { pool } = makePool([
      { rows: [{ id: TOOL_ID, slug: "fetch", title: "Fetch", protocol: "http", created_at: new Date() }] },
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
  });
});

describe("handleAttachTool", () => {
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
  it("204 on successful detach", async () => {
    const { pool } = makePool([
      { rows: [{ id: AGENT_ID, builder_id: OWNER_ID }] },
      { rows: [{ agent_id: AGENT_ID }] },
    ]);
    const req = new Request(
      `http://localhost/api/agents/${AGENT_ID}/tools/${TOOL_ID}`,
      { method: "DELETE", headers: { Authorization: ownerToken() } }
    );
    const res = await handleDetachTool(req, pool as any, AGENT_ID, TOOL_ID);
    expect(res.status).toBe(204);
  });
});
```

- [ ] **Step 3: Run tests, verify pass**

Run: `bun test server/src/handlers/tools.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add server/src/handlers/tools.ts server/src/handlers/tools.test.ts
git commit -m "feat(api): tools registry endpoints (#215)"
```

---

## Task 8: Wire routes in `server/src/index.ts`

**Files:**
- Modify: `server/src/index.ts`

- [ ] **Step 1: Add imports**

At top of `server/src/index.ts` (with other handler imports around line 14):

```ts
import {
  handleListSkills,
  handleGetSkill,
  handleCreateSkill,
  handleAttachSkill,
  handleDetachSkill,
} from "./handlers/skills";
import {
  handleListTools,
  handleGetTool,
  handleCreateTool,
  handleAttachTool,
  handleDetachTool,
} from "./handlers/tools";
```

- [ ] **Step 2: Wire routes**

Find the `// Agent hires` block (around line 167) and add BEFORE the retire route (so the `:id/skills` and `:id/tools` patterns match before the `DELETE /api/agents/:id` retire):

```ts
// Skills registry + attachments (issue #215).
if (url.pathname === "/api/skills" && req.method === "GET") {
  try { return await handleListSkills(url, pool); }
  catch (err) { console.error("[skills] GET /api/skills error:", err); return json({ error: "internal_error" }, 500); }
}
if (url.pathname === "/api/skills" && req.method === "POST") {
  try { return await handleCreateSkill(req, pool); }
  catch (err) { console.error("[skills] POST /api/skills error:", err); return json({ error: "internal_error" }, 500); }
}
{
  const m = url.pathname.match(/^\/api\/skills\/([^/]+)$/);
  if (m && req.method === "GET") {
    try { return await handleGetSkill(m[1], pool); }
    catch (err) { console.error("[skills] GET /api/skills/:slug error:", err); return json({ error: "internal_error" }, 500); }
  }
}
{
  const m = url.pathname.match(/^\/api\/agents\/([^/]+)\/skills(?:\/([^/]+))?$/);
  if (m) {
    const agentId = m[1];
    const skillId = m[2];
    try {
      if (!skillId && req.method === "POST") return await handleAttachSkill(req, pool, agentId);
      if (skillId && req.method === "DELETE") return await handleDetachSkill(req, pool, agentId, skillId);
    } catch (err) {
      console.error("[skills] /api/agents/:id/skills error:", err);
      return json({ error: "internal_error" }, 500);
    }
  }
}

// Tools registry + attachments (issue #215).
if (url.pathname === "/api/tools" && req.method === "GET") {
  try { return await handleListTools(url, pool); }
  catch (err) { console.error("[tools] GET /api/tools error:", err); return json({ error: "internal_error" }, 500); }
}
if (url.pathname === "/api/tools" && req.method === "POST") {
  try { return await handleCreateTool(req, pool); }
  catch (err) { console.error("[tools] POST /api/tools error:", err); return json({ error: "internal_error" }, 500); }
}
{
  const m = url.pathname.match(/^\/api\/tools\/([^/]+)$/);
  if (m && req.method === "GET") {
    try { return await handleGetTool(m[1], pool); }
    catch (err) { console.error("[tools] GET /api/tools/:slug error:", err); return json({ error: "internal_error" }, 500); }
  }
}
{
  const m = url.pathname.match(/^\/api\/agents\/([^/]+)\/tools(?:\/([^/]+))?$/);
  if (m) {
    const agentId = m[1];
    const toolId = m[2];
    try {
      if (!toolId && req.method === "POST") return await handleAttachTool(req, pool, agentId);
      if (toolId && req.method === "DELETE") return await handleDetachTool(req, pool, agentId, toolId);
    } catch (err) {
      console.error("[tools] /api/agents/:id/tools error:", err);
      return json({ error: "internal_error" }, 500);
    }
  }
}
```

- [ ] **Step 3: Run full server test suite**

Run: `cd server && bun test`
Expected: PASS (all existing + new)

- [ ] **Step 4: Run lint + typecheck**

Run: `bun run lint`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/index.ts
git commit -m "feat(api): wire skills + tools routes (#215)"
```

---

## Task 9: Self-review + push

- [ ] **Step 1: Run Quality Gate checks manually**

- Secrets: `gitleaks` / grep in diff.
- No hardcoded URLs / UUIDs / magic numbers (limits are named constants ✓).
- SQL: all parameterized ✓.
- No `SELECT *` ✓.
- New WHERE columns (`slug`, `category`) — already indexed by migration 032 ✓.
- No duplicate helpers (helpers inlined per module to keep them self-contained; matches repo style since `agent-hires.ts` also has local auth helpers).

- [ ] **Step 2: Push + open PR**

Per STEP 4 in custom instructions.

---

import type { Pool } from "pg";
import { timingSafeEqual } from "node:crypto";
import { json } from "../http/response";
import { authenticateBuilder, loadOwnedAgent } from "../http/auth-helpers";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const MAX_TITLE_LENGTH = 128;
const MAX_DESCRIPTION_LENGTH = 2000;
const MAX_VERSION_LENGTH = 32;
const MAX_CATEGORY_LENGTH = 64;
const MAX_URL_LENGTH = 512;
const MAX_CONTENT_MD_LENGTH = 500_000;

function verifyInternalToken(req: Request): Response | null {
  const expected = process.env.HIVE_INTERNAL_TOKEN;
  if (!expected) {
    console.error("[skills] HIVE_INTERNAL_TOKEN not configured");
    return json({ error: "internal_not_configured" }, 500);
  }
  const provided = req.headers.get("X-Hive-Internal-Token");
  if (!provided) return json({ error: "unauthorized", message: "Unauthorized" }, 401);
  // Constant-time comparison to prevent timing attacks on the shared secret.
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return json({ error: "unauthorized", message: "Unauthorized" }, 401);
  }
  return null;
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

export async function handleCreateSkill(req: Request, pool: Pool): Promise<Response> {
  const unauthorized = verifyInternalToken(req);
  if (unauthorized) return unauthorized;

  const body = (await req.json().catch(() => null)) as {
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

import type { Pool } from "pg";
import { timingSafeEqual } from "node:crypto";
import { json } from "../http/response";
import { authenticateBuilder, loadOwnedAgent } from "../http/auth-helpers";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

// Must match the CHECK constraint in migration 032_skills_tools.sql.
const VALID_PROTOCOLS = ["mcp", "http", "websocket", "native"] as const;
type Protocol = typeof VALID_PROTOCOLS[number];

const MAX_TITLE_LENGTH = 128;
const MAX_DESCRIPTION_LENGTH = 2000;
const MAX_CATEGORY_LENGTH = 64;

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

  const body = (await req.json().catch(() => null)) as {
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

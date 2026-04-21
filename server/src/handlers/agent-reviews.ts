import type { Pool } from "pg";
import { json } from "../http/response";
import { verifyBuilderToken } from "../auth/index";
import type { Route } from "../router/route-types";
import { logAndWrap } from "../router/middleware";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_CONTENT_LENGTH = 2000;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

type BuilderPrincipal = { builderId: string };

function parseBuilder(req: Request): BuilderPrincipal | null {
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const decoded = verifyBuilderToken(auth.slice(7));
  if (!decoded) return null;
  return { builderId: decoded.builder_id };
}

async function loadAgent(
  pool: Pool,
  agentId: string
): Promise<{ id: string; builder_id: string } | null> {
  if (!UUID_RE.test(agentId)) return null;
  const { rows } = await pool.query(
    `SELECT id, builder_id FROM agents WHERE id = $1`,
    [agentId]
  );
  return rows[0] ?? null;
}

async function hasForkedAgent(
  pool: Pool,
  agentId: string,
  builderId: string
): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT EXISTS (
       SELECT 1 FROM agent_forks
       WHERE parent_agent_id = $1 AND forking_builder_id = $2
     ) AS exists`,
    [agentId, builderId]
  );
  return rows[0]?.exists === true;
}

export async function handleGetReviews(
  req: Request,
  pool: Pool,
  agentId: string
): Promise<Response> {
  const agent = await loadAgent(pool, agentId);
  if (!agent) {
    return json({ error: "not_found", message: "Agent not found" }, 404);
  }

  const url = new URL(req.url);
  const limitParam = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(limitParam) && limitParam > 0
    ? Math.min(Math.floor(limitParam), MAX_LIMIT)
    : DEFAULT_LIMIT;

  const { rows: reviewRows } = await pool.query(
    `SELECT r.id, r.rating, r.content, r.created_at,
            r.reviewer_builder_id,
            b.display_name AS reviewer_display_name
     FROM agent_reviews r
     JOIN builders b ON b.id = r.reviewer_builder_id
     WHERE r.agent_id = $1
     ORDER BY r.created_at DESC
     LIMIT $2`,
    [agentId, limit]
  );

  const { rows: aggRows } = await pool.query(
    `SELECT COUNT(*)::int AS count, AVG(rating)::numeric(3,2) AS avg
     FROM agent_reviews
     WHERE agent_id = $1`,
    [agentId]
  );
  const agg = aggRows[0] ?? { count: 0, avg: null };
  const avgRating = agg.avg === null || agg.avg === undefined
    ? null
    : Number(agg.avg);

  const reviews = reviewRows.map((r: Record<string, unknown>) => ({
    id: r.id,
    rating: r.rating,
    content: r.content,
    created_at: r.created_at,
    reviewer: {
      id: r.reviewer_builder_id,
      display_name: r.reviewer_display_name,
    },
  }));

  const principal = parseBuilder(req);
  if (!principal) {
    return json({ reviews, avg_rating: avgRating, count: agg.count ?? 0 });
  }

  const isOwner = agent.builder_id === principal.builderId;
  let hasReviewed = false;
  let canReview = false;

  if (!isOwner) {
    const { rows: existingRows } = await pool.query(
      `SELECT id FROM agent_reviews
       WHERE agent_id = $1 AND reviewer_builder_id = $2`,
      [agentId, principal.builderId]
    );
    hasReviewed = existingRows.length > 0;
    const forked = await hasForkedAgent(pool, agentId, principal.builderId);
    canReview = forked;
  }

  return json({
    reviews,
    avg_rating: avgRating,
    count: agg.count ?? 0,
    viewer: {
      is_owner: isOwner,
      has_reviewed: hasReviewed,
      can_review: canReview,
    },
  });
}

export async function handlePostReview(
  req: Request,
  pool: Pool,
  agentId: string
): Promise<Response> {
  const principal = parseBuilder(req);
  if (!principal) {
    return json(
      { error: "auth_required", message: "Authorization header required" },
      401
    );
  }

  const agent = await loadAgent(pool, agentId);
  if (!agent) {
    return json({ error: "not_found", message: "Agent not found" }, 404);
  }

  if (agent.builder_id === principal.builderId) {
    return json(
      { error: "cannot_review_own", message: "You cannot review your own agent" },
      403
    );
  }

  const forked = await hasForkedAgent(pool, agentId, principal.builderId);
  if (!forked) {
    return json(
      {
        error: "not_eligible",
        message: "Only builders who have forked this agent can review it",
      },
      403
    );
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return json({ error: "validation_error", message: "JSON body required" }, 400);
  }

  const rating = body.rating;
  if (
    typeof rating !== "number" ||
    !Number.isInteger(rating) ||
    rating < 1 ||
    rating > 5
  ) {
    return json(
      { error: "validation_error", message: "rating must be an integer 1-5" },
      400
    );
  }

  let content: string | null = null;
  if (body.content !== undefined && body.content !== null) {
    if (typeof body.content !== "string") {
      return json(
        { error: "validation_error", message: "content must be a string" },
        400
      );
    }
    const trimmed = body.content.trim();
    if (trimmed.length > MAX_CONTENT_LENGTH) {
      return json(
        {
          error: "validation_error",
          message: `content must be ${MAX_CONTENT_LENGTH} chars or fewer`,
        },
        400
      );
    }
    content = trimmed.length === 0 ? null : trimmed;
  }

  // Upsert: a builder can edit their prior review in place. We return `xmax`
  // to distinguish INSERT (xmax=0 → 201) from UPDATE (xmax≠0 → 200).
  const { rows } = await pool.query(
    `INSERT INTO agent_reviews (agent_id, reviewer_builder_id, rating, content)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (agent_id, reviewer_builder_id) DO UPDATE
       SET rating = EXCLUDED.rating,
           content = EXCLUDED.content,
           updated_at = now()
     RETURNING id, rating, content, created_at, updated_at, (xmax <> 0) AS updated`,
    [agentId, principal.builderId, rating, content]
  );

  const row = rows[0];
  const wasUpdate = row.updated === true;
  return json(
    {
      review: {
        id: row.id,
        rating: row.rating,
        content: row.content,
        created_at: row.created_at,
        updated_at: row.updated_at,
      },
    },
    wasUpdate ? 200 : 201
  );
}

export const routes: Route[] = [
  {
    method: "GET",
    path: "/api/agents/:id/reviews",
    handler: logAndWrap(
      (ctx) => handleGetReviews(ctx.req, ctx.pool, ctx.params.id),
      "reviews",
    ),
  },
  {
    method: "POST",
    path: "/api/agents/:id/reviews",
    handler: logAndWrap(
      (ctx) => handlePostReview(ctx.req, ctx.pool, ctx.params.id),
      "reviews",
    ),
  },
];

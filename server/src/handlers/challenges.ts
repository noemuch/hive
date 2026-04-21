import type { Pool } from "pg";
import { json } from "../http/response";
import { authenticateBuilder } from "../http/auth-helpers";
import type { Route } from "../router/route-types";
import { logAndWrap } from "../router/middleware";

/**
 * Weekly Challenge Gallery (issue #240, amendment A6).
 *
 * Showcases brief-based head-to-head comparison of agents:
 *   - A challenge is a weekly timed brief (id, slug, prompt, rubric_variant,
 *     starts_at, ends_at).
 *   - challenge_submissions link a challenge × agent × artifact (one per agent
 *     per challenge; enforced by UNIQUE(challenge_id, agent_id)).
 *   - challenge_votes are idempotent builder upvotes; vote_count is a
 *     denormalized counter kept in sync via a post-insert UPDATE — trading one
 *     extra query per vote (rare path) for O(1) read on the grid (hot path).
 *
 * Ranking reads order submissions by (score_state_mu NULLS LAST, vote_count).
 * When HEAR score hasn't been computed yet (<72h window, or no peer eval), we
 * fall back to vote_count so the grid doesn't look empty on day one.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const VALID_STATUSES = new Set(["draft", "active", "completed"]);

// Keep the gallery responsive — N submissions on the landing grid is enough.
const CURRENT_SUBMISSIONS_PREVIEW_LIMIT = 24;

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

type ChallengeRow = {
  id: string;
  slug: string;
  title: string;
  prompt: string;
  agent_type_filter: string[];
  rubric_variant: string;
  starts_at: Date | string;
  ends_at: Date | string;
  status: string;
  created_by: string | null;
  created_at: Date | string;
};

/**
 * GET /api/challenges — archive + active challenges.
 *
 * Query params:
 *   - status=draft|active|completed (optional, filters by status)
 *   - limit / offset (paginated)
 *
 * Returns challenge summaries with submission_count (no submissions body, to
 * keep the archive payload small — individual challenge endpoint returns
 * full submission list).
 */
export async function handleListChallenges(
  url: URL,
  pool: Pool
): Promise<Response> {
  const status = (url.searchParams.get("status") ?? "").trim();
  if (status.length > 0 && !VALID_STATUSES.has(status)) {
    return json(
      { error: "validation_error", message: "Invalid status filter" },
      400
    );
  }
  const limit = clampLimit(url.searchParams.get("limit"));
  const offset = clampOffset(url.searchParams.get("offset"));

  const clauses: string[] = [];
  const params: unknown[] = [];
  if (status.length > 0) {
    params.push(status);
    clauses.push(`c.status = $${params.length}`);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  params.push(limit);
  params.push(offset);

  const { rows } = await pool.query(
    `SELECT c.id, c.slug, c.title, c.prompt, c.agent_type_filter,
            c.rubric_variant, c.starts_at, c.ends_at, c.status, c.created_at,
            (SELECT COUNT(*) FROM challenge_submissions s WHERE s.challenge_id = c.id)::int AS submission_count
     FROM challenges c
     ${where}
     ORDER BY c.ends_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return json({ challenges: rows, limit, offset });
}

/**
 * GET /api/challenges/current — the one active challenge (if any) + its top
 * submissions for the landing page. Returns 404 when no challenge is active,
 * so the client can render an "no challenge running yet" empty state.
 */
export async function handleGetCurrentChallenge(pool: Pool): Promise<Response> {
  const { rows: challengeRows } = await pool.query<ChallengeRow>(
    `SELECT id, slug, title, prompt, agent_type_filter, rubric_variant,
            starts_at, ends_at, status, created_by, created_at
     FROM challenges
     WHERE status = 'active'
       AND starts_at <= now()
       AND ends_at > now()
     ORDER BY ends_at ASC
     LIMIT 1`
  );
  if (challengeRows.length === 0) {
    return json({ error: "not_found", message: "No active challenge" }, 404);
  }
  const challenge = challengeRows[0];

  const { rows: submissionRows } = await pool.query(
    `SELECT s.id AS submission_id, s.agent_id, a.name AS agent_name,
            a.avatar_seed AS agent_avatar_seed,
            s.artifact_id, ar.type AS artifact_type, ar.title AS artifact_title,
            ar.media_url AS artifact_media_url,
            ar.media_mime AS artifact_media_mime,
            s.submitted_at, s.vote_count,
            a.score_state_mu
     FROM challenge_submissions s
     JOIN agents a ON a.id = s.agent_id
     JOIN artifacts ar ON ar.id = s.artifact_id
     WHERE s.challenge_id = $1
     ORDER BY COALESCE(a.score_state_mu, 0) DESC, s.vote_count DESC, s.submitted_at DESC
     LIMIT $2`,
    [challenge.id, CURRENT_SUBMISSIONS_PREVIEW_LIMIT]
  );

  return json({ challenge, submissions: submissionRows });
}

/**
 * GET /api/challenges/:slug — single challenge + all submissions.
 *
 * Submissions are ordered by (score_state_mu desc, vote_count desc, submitted_at
 * desc) so the leaderboard surfaces peer-evaluated winners first, with
 * community votes as a tiebreaker and recency as a final fallback.
 */
export async function handleGetChallenge(
  slug: string,
  pool: Pool
): Promise<Response> {
  if (!SLUG_RE.test(slug)) {
    return json({ error: "validation_error", message: "Invalid slug" }, 400);
  }
  const { rows: challengeRows } = await pool.query<ChallengeRow>(
    `SELECT id, slug, title, prompt, agent_type_filter, rubric_variant,
            starts_at, ends_at, status, created_by, created_at
     FROM challenges
     WHERE slug = $1`,
    [slug]
  );
  if (challengeRows.length === 0) {
    return json({ error: "not_found", message: "Challenge not found" }, 404);
  }
  const challenge = challengeRows[0];

  const { rows: submissionRows } = await pool.query(
    `SELECT s.id AS submission_id, s.agent_id, a.name AS agent_name,
            a.avatar_seed AS agent_avatar_seed,
            s.artifact_id, ar.type AS artifact_type, ar.title AS artifact_title,
            ar.media_url AS artifact_media_url,
            ar.media_mime AS artifact_media_mime,
            s.submitted_at, s.vote_count,
            a.score_state_mu
     FROM challenge_submissions s
     JOIN agents a ON a.id = s.agent_id
     JOIN artifacts ar ON ar.id = s.artifact_id
     WHERE s.challenge_id = $1
     ORDER BY COALESCE(a.score_state_mu, 0) DESC, s.vote_count DESC, s.submitted_at DESC`,
    [challenge.id]
  );

  return json({ challenge, submissions: submissionRows });
}

type SubmissionBody = {
  agent_id?: unknown;
  artifact_id?: unknown;
};

/**
 * POST /api/challenges/:slug/submissions
 *
 * Builder JWT required. The agent must be owned by the calling builder, and
 * the artifact must be authored by that agent. Both checks prevent an owner
 * from submitting artifacts that were produced by someone else's agent.
 *
 * agent_type_filter enforcement is soft: if the challenge declares a
 * non-empty filter, the artifact's type must be in it; if empty, any type is
 * accepted. This matches the seeded "code" challenge that accepts code_diff /
 * pr / document while leaving room for future "any-artefact" briefs.
 */
export async function handleCreateSubmission(
  req: Request,
  pool: Pool,
  slug: string
): Promise<Response> {
  const auth = authenticateBuilder(req);
  if (!auth.ok) return auth.response;

  if (!SLUG_RE.test(slug)) {
    return json({ error: "validation_error", message: "Invalid slug" }, 400);
  }

  const body = (await req.json().catch(() => null)) as SubmissionBody | null;
  if (!body || typeof body !== "object") {
    return json(
      { error: "validation_error", message: "JSON body required" },
      400
    );
  }
  const agentId =
    typeof body.agent_id === "string" ? body.agent_id.trim() : "";
  const artifactId =
    typeof body.artifact_id === "string" ? body.artifact_id.trim() : "";
  if (!UUID_RE.test(agentId) || !UUID_RE.test(artifactId)) {
    return json(
      {
        error: "validation_error",
        message: "agent_id and artifact_id must be UUIDs",
      },
      400
    );
  }

  const { rows: challengeRows } = await pool.query<
    Pick<ChallengeRow, "id" | "agent_type_filter" | "status" | "starts_at" | "ends_at">
  >(
    `SELECT id, agent_type_filter, status, starts_at, ends_at
     FROM challenges
     WHERE slug = $1`,
    [slug]
  );
  if (challengeRows.length === 0) {
    return json({ error: "not_found", message: "Challenge not found" }, 404);
  }
  const challenge = challengeRows[0];

  const now = new Date();
  const startsAt = new Date(challenge.starts_at);
  const endsAt = new Date(challenge.ends_at);
  if (
    challenge.status !== "active" ||
    now < startsAt ||
    now >= endsAt
  ) {
    return json(
      {
        error: "validation_error",
        message: "Challenge is not currently accepting submissions",
      },
      400
    );
  }

  const { rows: agentRows } = await pool.query<{
    id: string;
    builder_id: string;
  }>(`SELECT id, builder_id FROM agents WHERE id = $1`, [agentId]);
  if (agentRows.length === 0) {
    return json({ error: "not_found", message: "Agent not found" }, 404);
  }
  if (agentRows[0].builder_id !== auth.builderId) {
    return json({ error: "forbidden", message: "Not your agent" }, 403);
  }

  const { rows: artifactRows } = await pool.query<{
    id: string;
    author_id: string;
    type: string;
  }>(
    `SELECT id, author_id, type FROM artifacts WHERE id = $1 AND author_id = $2`,
    [artifactId, agentId]
  );
  if (artifactRows.length === 0) {
    return json(
      { error: "not_found", message: "Artifact not found for this agent" },
      404
    );
  }

  const filter = challenge.agent_type_filter ?? [];
  if (filter.length > 0 && !filter.includes(artifactRows[0].type)) {
    return json(
      {
        error: "validation_error",
        message: `Artifact type '${artifactRows[0].type}' not accepted for this challenge`,
      },
      400
    );
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO challenge_submissions (challenge_id, agent_id, artifact_id)
       VALUES ($1, $2, $3)
       RETURNING id, challenge_id, agent_id, artifact_id, submitted_at, vote_count`,
      [challenge.id, agentId, artifactId]
    );
    return json({ submission: rows[0] }, 201);
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code === "23505") {
      return json(
        { error: "conflict", message: "Agent already submitted to this challenge" },
        409
      );
    }
    throw err;
  }
}

/**
 * POST /api/challenges/:slug/submissions/:artifactId/vote
 *
 * Builder JWT required. Idempotent: a repeat vote by the same builder returns
 * 200 with already_voted=true instead of 409, so the UI can optimistically
 * submit without needing to track prior votes client-side.
 *
 * vote_count is maintained as a denormalized aggregate — bumped by +1 on the
 * first successful insert, left alone on duplicates. Reading the aggregate
 * from the submissions row avoids a COUNT(*) on every grid render.
 */
export async function handleVoteSubmission(
  req: Request,
  pool: Pool,
  slug: string,
  artifactId: string
): Promise<Response> {
  const auth = authenticateBuilder(req);
  if (!auth.ok) return auth.response;

  if (!SLUG_RE.test(slug)) {
    return json({ error: "validation_error", message: "Invalid slug" }, 400);
  }
  if (!UUID_RE.test(artifactId)) {
    return json(
      { error: "validation_error", message: "Invalid artifact id" },
      400
    );
  }

  const { rows: challengeRows } = await pool.query<{ id: string }>(
    `SELECT id FROM challenges WHERE slug = $1`,
    [slug]
  );
  if (challengeRows.length === 0) {
    return json({ error: "not_found", message: "Challenge not found" }, 404);
  }
  const challengeId = challengeRows[0].id;

  const { rows: submissionRows } = await pool.query<{ id: string }>(
    `SELECT id FROM challenge_submissions
     WHERE challenge_id = $1 AND artifact_id = $2`,
    [challengeId, artifactId]
  );
  if (submissionRows.length === 0) {
    return json({ error: "not_found", message: "Submission not found" }, 404);
  }

  let alreadyVoted = false;
  try {
    await pool.query(
      `INSERT INTO challenge_votes (challenge_id, artifact_id, voter_builder_id)
       VALUES ($1, $2, $3)`,
      [challengeId, artifactId, auth.builderId]
    );
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code === "23505") {
      alreadyVoted = true;
    } else {
      throw err;
    }
  }

  if (!alreadyVoted) {
    // Bump the denormalized vote_count. Safe under concurrent inserts because
    // PostgreSQL serializes the UPDATE on the row lock and each vote fires
    // exactly once (duplicates are absorbed by the UNIQUE above).
    const { rows } = await pool.query<{ vote_count: number }>(
      `UPDATE challenge_submissions
       SET vote_count = vote_count + 1
       WHERE challenge_id = $1 AND artifact_id = $2
       RETURNING vote_count`,
      [challengeId, artifactId]
    );
    return json(
      {
        vote_count: rows[0]?.vote_count ?? 1,
        already_voted: false,
      },
      201
    );
  }

  const { rows: current } = await pool.query<{ vote_count: number }>(
    `SELECT vote_count FROM challenge_submissions
     WHERE challenge_id = $1 AND artifact_id = $2`,
    [challengeId, artifactId]
  );
  return json(
    {
      vote_count: current[0]?.vote_count ?? 0,
      already_voted: true,
    },
    200
  );
}

export const routes: Route[] = [
  {
    method: "GET",
    path: "/api/challenges",
    handler: logAndWrap(
      (ctx) => handleListChallenges(ctx.url, ctx.pool),
      "challenges"
    ),
  },
  {
    method: "GET",
    path: "/api/challenges/current",
    handler: logAndWrap(
      (ctx) => handleGetCurrentChallenge(ctx.pool),
      "challenges"
    ),
  },
  {
    method: "GET",
    path: "/api/challenges/:slug",
    handler: logAndWrap(
      (ctx) => handleGetChallenge(ctx.params.slug, ctx.pool),
      "challenges"
    ),
  },
  {
    method: "POST",
    path: "/api/challenges/:slug/submissions",
    handler: logAndWrap(
      (ctx) => handleCreateSubmission(ctx.req, ctx.pool, ctx.params.slug),
      "challenges"
    ),
  },
  {
    method: "POST",
    path: "/api/challenges/:slug/submissions/:artifactId/vote",
    handler: logAndWrap(
      (ctx) =>
        handleVoteSubmission(
          ctx.req,
          ctx.pool,
          ctx.params.slug,
          ctx.params.artifactId
        ),
      "challenges"
    ),
  },
];

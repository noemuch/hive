import type { Pool } from "pg";
import { json, CORS } from "../http/response";
import { authenticateBuilder, loadOwnedAgent } from "../http/auth-helpers";
import type { Route } from "../router/route-types";
import { logAndWrap } from "../router/middleware";

// Builder-curated showcase pins on an agent profile. A5 · #234.
//
// Privacy contract: pinning an artefact flips `artifacts.is_showcase_public`
// to true in the same transaction; unpinning clears it. The artifact read
// path (server/src/handlers/artifact.ts::handleArtifactGet) treats
// `is_showcase_public` as a per-artefact OR with the author's global
// `is_artifact_content_public`, so pinned artefacts are publicly viewable
// even when the agent's default is private.
//
// Slot model: positions are 1..5, enforced by DB (CHECK + UNIQUE). The API
// accepts an optional `position` on POST; when omitted, the first free slot
// (1..5) is assigned server-side.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_SHOWCASE_SLOTS = 5;

type PinRow = {
  position: number;
  pinned_at: string;
  artifact_id: string;
  artifact_type: string;
  artifact_title: string;
  artifact_content: string;
  artifact_created_at: string;
  artifact_media_url: string | null;
  artifact_media_mime: string | null;
  score: number | string | null;
};

/**
 * GET /api/agents/:id/showcase
 * Public. Returns ordered 0..5 pins. `content` is always returned for
 * showcase pins — pinning is an explicit public opt-in by the builder.
 */
export async function handleShowcaseGet(
  agentId: string,
  pool: Pool
): Promise<Response> {
  if (!UUID_RE.test(agentId)) {
    return json({ error: "not_found", message: "Agent not found" }, 404);
  }

  const { rows } = await pool.query<PinRow>(
    `SELECT s.position, s.pinned_at,
            ar.id         AS artifact_id,
            ar.type       AS artifact_type,
            ar.title      AS artifact_title,
            ar.content    AS artifact_content,
            ar.created_at AS artifact_created_at,
            ar.media_url  AS artifact_media_url,
            ar.media_mime AS artifact_media_mime,
            (SELECT AVG(qe.score_state_mu)::float
               FROM quality_evaluations qe
               WHERE qe.artifact_id = ar.id
                 AND qe.invalidated_at IS NULL
                 AND qe.score_state_mu IS NOT NULL) AS score
     FROM agent_showcase s
     JOIN artifacts ar ON ar.id = s.artifact_id
     WHERE s.agent_id = $1
     ORDER BY s.position ASC
     LIMIT $2`,
    [agentId, MAX_SHOWCASE_SLOTS]
  );

  const pins = rows.map((r) => ({
    position: r.position,
    pinned_at: r.pinned_at,
    artifact: {
      id: r.artifact_id,
      type: r.artifact_type,
      title: r.artifact_title,
      content: r.artifact_content,
      created_at: r.artifact_created_at,
      media_url: r.artifact_media_url,
      media_mime: r.artifact_media_mime,
      score: r.score === null ? null : Number(r.score),
    },
  }));

  return json({ pins });
}

/**
 * POST /api/agents/:id/showcase
 * Body: `{ artifact_id: UUID, position?: 1..5 }`.
 * JWT-protected, owner-only. On success returns `{ pin: {...} }`.
 *
 * Verifies the artefact belongs to the agent (prevents pinning someone
 * else's work). When `position` is omitted, the handler picks the lowest
 * free slot. When `position` is supplied and already held, the UNIQUE
 * constraint returns 409 (builder is expected to DELETE the prior pin
 * first — this avoids accidental overwrites).
 */
export async function handleShowcasePin(
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

  const artifactId = typeof body.artifact_id === "string" ? body.artifact_id : "";
  if (!UUID_RE.test(artifactId)) {
    return json(
      { error: "validation_error", message: "artifact_id must be a UUID" },
      400
    );
  }

  let position: number | null = null;
  if (body.position !== undefined && body.position !== null) {
    const n = Number(body.position);
    if (!Number.isInteger(n) || n < 1 || n > MAX_SHOWCASE_SLOTS) {
      return json(
        {
          error: "validation_error",
          message: `position must be integer 1-${MAX_SHOWCASE_SLOTS}`,
        },
        400
      );
    }
    position = n;
  }

  // Verify the artefact exists AND is owned by the target agent.
  const { rows: artifactRows } = await pool.query<{ author_id: string }>(
    `SELECT author_id FROM artifacts WHERE id = $1`,
    [artifactId]
  );
  if (artifactRows.length === 0) {
    return json({ error: "not_found", message: "Artifact not found" }, 404);
  }
  if (artifactRows[0].author_id !== agentId) {
    return json(
      { error: "forbidden", message: "Artifact not authored by this agent" },
      403
    );
  }

  // Current pin set — used to pick a free slot if the caller omitted one
  // AND to enforce the 5-pin ceiling independently of the UNIQUE.
  const { rows: existingRows } = await pool.query<{ position: number }>(
    `SELECT position FROM agent_showcase WHERE agent_id = $1 ORDER BY position`,
    [agentId]
  );
  if (existingRows.length >= MAX_SHOWCASE_SLOTS) {
    return json(
      {
        error: "showcase_full",
        message: `Showcase already has ${MAX_SHOWCASE_SLOTS} pins — unpin one first`,
      },
      409
    );
  }

  if (position === null) {
    const used = new Set(existingRows.map((r) => r.position));
    for (let p = 1; p <= MAX_SHOWCASE_SLOTS; p++) {
      if (!used.has(p)) {
        position = p;
        break;
      }
    }
    // Shouldn't happen — existingRows.length < MAX guarantees a slot — but
    // return 500 over a silent null to surface the invariant if it ever trips.
    if (position === null) {
      return json({ error: "internal_error" }, 500);
    }
  }

  // Single transaction: insert the pin + flip is_showcase_public. Either both
  // happen or neither — prevents an orphaned public flag on insertion failure.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO agent_showcase (agent_id, artifact_id, position)
       VALUES ($1, $2, $3)`,
      [agentId, artifactId, position]
    );
    await client.query(
      `UPDATE artifacts SET is_showcase_public = true WHERE id = $1`,
      [artifactId]
    );
    await client.query("COMMIT");
  } catch (err: unknown) {
    await client.query("ROLLBACK").catch(() => {});
    // Postgres 23505 = unique_violation (either agent_id+artifact_id PK or
    // agent_id+position UNIQUE). Map both to 409 for the builder UI.
    const code = (err as { code?: string } | null)?.code;
    if (code === "23505") {
      return json(
        {
          error: "conflict",
          message: "Artifact already pinned or position already taken",
        },
        409
      );
    }
    throw err;
  } finally {
    client.release();
  }

  return json(
    {
      pin: { agent_id: agentId, artifact_id: artifactId, position },
    },
    201
  );
}

/**
 * DELETE /api/agents/:id/showcase/:position
 * JWT-protected, owner-only. Unpin the artefact at `position`.
 * Flips `artifacts.is_showcase_public = false` in the same TX.
 */
export async function handleShowcaseUnpin(
  req: Request,
  pool: Pool,
  agentId: string,
  positionParam: string
): Promise<Response> {
  const auth = authenticateBuilder(req);
  if (!auth.ok) return auth.response;

  const ownership = await loadOwnedAgent(pool, agentId, auth.builderId);
  if (!ownership.ok) return ownership.response;

  const position = Number(positionParam);
  if (!Number.isInteger(position) || position < 1 || position > MAX_SHOWCASE_SLOTS) {
    return json(
      {
        error: "validation_error",
        message: `position must be integer 1-${MAX_SHOWCASE_SLOTS}`,
      },
      400
    );
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: del } = await client.query<{ artifact_id: string }>(
      `DELETE FROM agent_showcase
       WHERE agent_id = $1 AND position = $2
       RETURNING artifact_id`,
      [agentId, position]
    );
    if (del.length === 0) {
      await client.query("ROLLBACK");
      return json({ error: "not_found", message: "No pin at that position" }, 404);
    }
    await client.query(
      `UPDATE artifacts SET is_showcase_public = false WHERE id = $1`,
      [del[0].artifact_id]
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  return new Response(null, { status: 204, headers: CORS });
}

export const routes: Route[] = [
  {
    method: "GET",
    path: "/api/agents/:id/showcase",
    handler: logAndWrap(
      (ctx) => handleShowcaseGet(ctx.params.id, ctx.pool),
      "showcase-get"
    ),
  },
  {
    method: "POST",
    path: "/api/agents/:id/showcase",
    handler: logAndWrap(
      (ctx) => handleShowcasePin(ctx.req, ctx.pool, ctx.params.id),
      "showcase-pin"
    ),
  },
  {
    method: "DELETE",
    path: "/api/agents/:id/showcase/:position",
    handler: logAndWrap(
      (ctx) =>
        handleShowcaseUnpin(ctx.req, ctx.pool, ctx.params.id, ctx.params.position),
      "showcase-unpin"
    ),
  },
];

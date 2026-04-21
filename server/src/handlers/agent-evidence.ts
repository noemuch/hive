import type { Pool } from "pg";
import { json } from "../http/response";
import type { Route } from "../router/route-types";
import { logAndWrap } from "../router/middleware";

// GET /api/agents/:id/evidence
// A5 · #234. Returns peer-eval evidence quotes grouped per HEAR axis so
// the agent profile can render a tabbed "proof of judgment" view without
// re-requesting each peer_evaluation row.
//
// Shape tolerance: peer_evaluations.evidence_quotes accepts two jsonb
// shapes (see migration 043 doc comment):
//   (a) Legacy flat `string[]` — pre-A5 rows. Assigned to a synthetic
//       "general" bucket so the client can still surface them as
//       "unattributed to axis".
//   (b) Per-axis `{axis: string[]}` — post-A5. Distributed directly into
//       the returned axis buckets.
//
// The endpoint is public (same visibility as the agent profile page).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_QUOTES_PER_AXIS = 7;

type EvidenceRow = {
  evaluation_id: string;
  evidence_quotes: unknown;
  scores: unknown;
  confidence: number | string | null;
  completed_at: string | null;
  evaluator_name: string;
  evaluator_role: string;
};

type ProfileCitation = {
  quote: string;
  evaluator_name: string;
  evaluator_role: string;
  score: number;
};

type AxisGroup = {
  axis: string;
  quotes: ProfileCitation[];
};

/**
 * Normalize the jsonb `scores` blob into a map. Postgres may hand us a
 * parsed object (node-pg jsonb mode) or a raw string.
 */
function coerceScores(raw: unknown): Record<string, number | null> {
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return coerceScores(parsed);
    } catch {
      return {};
    }
  }
  if (typeof raw !== "object") return {};
  const out: Record<string, number | null> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "number") out[k] = v;
    else if (v === null) out[k] = null;
  }
  return out;
}

/**
 * Normalize evidence_quotes to either string[] or Record<string, string[]>.
 * Returns null when the column is an unexpected shape.
 */
function coerceEvidence(
  raw: unknown
): string[] | Record<string, string[]> | null {
  if (!raw) return null;
  if (typeof raw === "string") {
    try {
      return coerceEvidence(JSON.parse(raw));
    } catch {
      return null;
    }
  }
  if (Array.isArray(raw)) {
    return raw.filter((q): q is string => typeof q === "string");
  }
  if (typeof raw === "object") {
    const out: Record<string, string[]> = {};
    for (const [axis, quotes] of Object.entries(raw as Record<string, unknown>)) {
      if (Array.isArray(quotes)) {
        const filtered = quotes.filter((q): q is string => typeof q === "string");
        if (filtered.length > 0) out[axis] = filtered;
      }
    }
    return out;
  }
  return null;
}

export async function handleAgentEvidence(
  agentId: string,
  pool: Pool
): Promise<Response> {
  if (!UUID_RE.test(agentId)) {
    return json({ error: "not_found", message: "Agent not found" }, 404);
  }

  // Verify the agent exists + is not retired. Mirrors agent-profile.ts.
  const { rows: agentRows } = await pool.query<{ status: string }>(
    `SELECT status FROM agents WHERE id = $1`,
    [agentId]
  );
  if (agentRows.length === 0 || agentRows[0].status === "retired") {
    return json({ error: "not_found", message: "Agent not found" }, 404);
  }

  // Pull completed peer evaluations targeting this agent's artefacts,
  // newest-first so the freshest quotes land in each axis bucket first.
  // LIMIT is per-agent, not per-axis — we'll post-filter to MAX_QUOTES_PER_AXIS
  // in TS to keep the SQL simple. A typical agent has <100 evals so this
  // is cheap.
  const { rows } = await pool.query<EvidenceRow>(
    `SELECT pe.id AS evaluation_id,
            pe.evidence_quotes,
            pe.scores,
            pe.confidence,
            pe.completed_at,
            ev.name AS evaluator_name,
            ev.role AS evaluator_role
     FROM peer_evaluations pe
     JOIN artifacts art ON art.id = pe.artifact_id AND art.author_id = $1
     JOIN agents    ev  ON ev.id  = pe.evaluator_agent_id
     WHERE pe.status = 'completed'
       AND pe.evidence_quotes IS NOT NULL
     ORDER BY pe.completed_at DESC NULLS LAST
     LIMIT 200`,
    [agentId]
  );

  const buckets = new Map<string, ProfileCitation[]>();
  const pushQuote = (axis: string, citation: ProfileCitation) => {
    let bucket = buckets.get(axis);
    if (!bucket) {
      bucket = [];
      buckets.set(axis, bucket);
    }
    if (bucket.length >= MAX_QUOTES_PER_AXIS) return;
    bucket.push(citation);
  };

  for (const row of rows) {
    const evidence = coerceEvidence(row.evidence_quotes);
    if (!evidence) continue;
    const scores = coerceScores(row.scores);
    const confidence = row.confidence === null ? 0 : Number(row.confidence);

    if (Array.isArray(evidence)) {
      // Legacy flat shape — unattributable to a specific axis. Bucket as
      // "general" so the client can offer a fallback tab. Score = overall
      // confidence, since we can't map quote→axis.
      for (const quote of evidence) {
        pushQuote("general", {
          quote,
          evaluator_name: row.evaluator_name,
          evaluator_role: row.evaluator_role,
          score: confidence,
        });
      }
      continue;
    }

    // Per-axis shape — each quote gets the axis' actual score when the
    // evaluator scored that axis, else the overall confidence.
    for (const [axis, quotes] of Object.entries(evidence)) {
      const axisScore = scores[axis];
      const displayScore =
        typeof axisScore === "number" ? axisScore : confidence;
      for (const quote of quotes) {
        pushQuote(axis, {
          quote,
          evaluator_name: row.evaluator_name,
          evaluator_role: row.evaluator_role,
          score: displayScore,
        });
      }
    }
  }

  const axes: AxisGroup[] = Array.from(buckets.entries())
    .map(([axis, quotes]) => ({ axis, quotes }))
    // Stable deterministic order: scored axes alphabetically, "general" last.
    .sort((a, b) => {
      if (a.axis === "general") return 1;
      if (b.axis === "general") return -1;
      return a.axis.localeCompare(b.axis);
    });

  return json({ axes });
}

export const routes: Route[] = [
  {
    method: "GET",
    path: "/api/agents/:id/evidence",
    handler: logAndWrap(
      (ctx) => handleAgentEvidence(ctx.params.id, ctx.pool),
      "evidence"
    ),
  },
];

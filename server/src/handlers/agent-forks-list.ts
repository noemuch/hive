import type { Pool } from "pg";
import { json } from "../http/response";

// Spec: issue #212 § "Solution" — GET /api/agents/:id/forks returns the
// list of child agents forked from :id so the parent profile can render
// the "X builders forked this agent" section.
//
// Read-only, public, cached briefly. Backed by `agent_forks` (migration
// 031) via `agent_forks_parent_idx` → no table scan.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;
const CACHE_MAX_AGE_SECONDS = 60;

type ForkRow = {
  child_agent_id: string;
  child_name: string;
  child_avatar_seed: string;
  builder_name: string | null;
  forked_at: Date | string;
};

type CountRow = { total: number | string };

function clampLimit(raw: string | null): number {
  if (raw === null) return DEFAULT_LIMIT;
  const parsed = parseInt(raw, 10);
  if (Number.isNaN(parsed)) return DEFAULT_LIMIT;
  return Math.min(Math.max(parsed, 1), MAX_LIMIT);
}

export async function handleAgentForksList(
  agentId: string,
  limitParam: string | null,
  pool: Pool
): Promise<Response> {
  if (!UUID_RE.test(agentId)) {
    return json({ error: "not_found", message: "Agent not found" }, 404);
  }

  const limit = clampLimit(limitParam);

  try {
    const { rows } = await pool.query<ForkRow>(
      `SELECT af.child_agent_id,
              c.name          AS child_name,
              c.avatar_seed   AS child_avatar_seed,
              b.display_name  AS builder_name,
              af.forked_at
       FROM agent_forks af
       JOIN agents   c ON c.id = af.child_agent_id
       LEFT JOIN builders b ON b.id = af.forking_builder_id
       WHERE af.parent_agent_id = $1
       ORDER BY af.forked_at DESC
       LIMIT $2`,
      [agentId, limit]
    );

    const { rows: countRows } = await pool.query<CountRow>(
      `SELECT COUNT(*)::int AS total FROM agent_forks WHERE parent_agent_id = $1`,
      [agentId]
    );
    const total = Number(countRows[0]?.total ?? 0);

    const forks = rows.map((r) => ({
      child_agent_id: r.child_agent_id,
      child_name: r.child_name,
      child_avatar_seed: r.child_avatar_seed,
      builder_name: r.builder_name,
      forked_at:
        r.forked_at instanceof Date ? r.forked_at.toISOString() : String(r.forked_at),
    }));

    const res = json({ forks, total });
    res.headers.set("Cache-Control", `public, max-age=${CACHE_MAX_AGE_SECONDS}`);
    return res;
  } catch (err) {
    console.error("[forks] /api/agents/:id/forks error:", err);
    return json({ error: "internal_error" }, 500);
  }
}

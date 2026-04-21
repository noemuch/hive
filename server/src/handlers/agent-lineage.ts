import { json } from "../http/response";
import type { Route } from "../router/route-types";
import { computeInheritance } from "../db/fork-inheritance";

// Spec: issue #241 A13 — Fork lineage + reputation inheritance with decay.
//
// GET /api/agents/:id/lineage returns the genealogy view needed by the
// agent profile's "Lineage" section:
//
//   {
//     parent: {
//       parent_agent_id, parent_name, parent_avatar_seed,
//       parent_company_name, forked_at, parent_mu_at_fork,
//       inheritance: { weight, component, days_remaining }
//     } | null,
//     children: [
//       { child_agent_id, child_name, child_avatar_seed,
//         own_mu, effective_mu, days_since_fork, forked_at }
//     ],
//     children_total: number
//   }
//
// Backed by `agent_forks` (migration 031) for parent lookup + the
// `agent_inherited_mu` VIEW (migration 038) for the children block so
// effective_mu is computed server-side with the canonical decay formula
// — no parallel math in Node.
//
// Read-only, public, briefly cached. Two queries, both index-backed:
// `agent_forks_child_idx` for parent direction, `agent_forks_parent_idx`
// for children direction.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CACHE_MAX_AGE_SECONDS = 60;
const CHILDREN_LIMIT = 50;

type Queryable = {
  query: <R = unknown>(
    text: string,
    params?: unknown[]
  ) => Promise<{ rows: R[] }>;
};

type ParentRow = {
  parent_agent_id: string;
  parent_name: string;
  parent_avatar_seed: string;
  parent_company_name: string | null;
  forked_at: Date | string;
  parent_mu_at_fork: string | number | null;
  days_since_fork: string | number;
};

type ChildRow = {
  child_agent_id: string;
  child_name: string;
  child_avatar_seed: string;
  own_mu: string | number | null;
  effective_mu: string | number | null;
  days_since_fork: string | number;
  forked_at: Date | string;
};

function asNumber(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function asIso(v: Date | string): string {
  return v instanceof Date ? v.toISOString() : String(v);
}

export async function handleAgentLineage(
  agentId: string,
  pool: Queryable
): Promise<Response> {
  if (!UUID_RE.test(agentId)) {
    return json({ error: "not_found", message: "Agent not found" }, 404);
  }

  try {
    const { rows: parentRows } = await pool.query<ParentRow>(
      `SELECT p.id           AS parent_agent_id,
              p.name         AS parent_name,
              p.avatar_seed  AS parent_avatar_seed,
              pc.name        AS parent_company_name,
              af.forked_at,
              af.parent_mu_at_fork,
              EXTRACT(EPOCH FROM (now() - af.forked_at)) / 86400.0 AS days_since_fork
       FROM agent_forks af
       JOIN agents p          ON p.id = af.parent_agent_id
       LEFT JOIN companies pc ON pc.id = p.company_id
       WHERE af.child_agent_id = $1
       LIMIT 1`,
      [agentId]
    );

    let parent: unknown = null;
    if (parentRows[0]) {
      const pr = parentRows[0];
      const parentMuAtFork = asNumber(pr.parent_mu_at_fork);
      const daysSinceFork = asNumber(pr.days_since_fork) ?? 0;
      const inheritance = computeInheritance({
        ownMu: null,
        parentMuAtFork,
        daysSinceFork,
      });
      parent = {
        parent_agent_id: pr.parent_agent_id,
        parent_name: pr.parent_name,
        parent_avatar_seed: pr.parent_avatar_seed,
        parent_company_name: pr.parent_company_name,
        forked_at: asIso(pr.forked_at),
        parent_mu_at_fork: parentMuAtFork,
        inheritance: {
          weight: inheritance.inheritanceWeight,
          component: inheritance.inheritedMuComponent,
          days_remaining: inheritance.daysRemaining,
        },
      };
    }

    const { rows: childRows } = await pool.query<ChildRow>(
      `SELECT af.child_agent_id,
              c.name          AS child_name,
              c.avatar_seed   AS child_avatar_seed,
              c.score_state_mu AS own_mu,
              aim.effective_mu,
              aim.days_since_fork,
              af.forked_at
       FROM agent_forks af
       JOIN agents c                 ON c.id = af.child_agent_id
       LEFT JOIN agent_inherited_mu aim ON aim.agent_id = af.child_agent_id
       WHERE af.parent_agent_id = $1
       ORDER BY af.forked_at DESC
       LIMIT $2`,
      [agentId, CHILDREN_LIMIT]
    );

    const children = childRows.map((r) => ({
      child_agent_id: r.child_agent_id,
      child_name: r.child_name,
      child_avatar_seed: r.child_avatar_seed,
      own_mu: asNumber(r.own_mu),
      effective_mu: asNumber(r.effective_mu),
      days_since_fork: asNumber(r.days_since_fork) ?? 0,
      forked_at: asIso(r.forked_at),
    }));

    const body = {
      parent,
      children,
      children_total: children.length,
    };

    const res = json(body);
    res.headers.set("Cache-Control", `public, max-age=${CACHE_MAX_AGE_SECONDS}`);
    return res;
  } catch (err) {
    console.error("[lineage] /api/agents/:id/lineage error:", err);
    return json({ error: "internal_error" }, 500);
  }
}

export const routes: Route[] = [
  {
    method: "GET",
    path: "/api/agents/:id/lineage",
    handler: (ctx) => handleAgentLineage(ctx.params.id, ctx.pool),
  },
];

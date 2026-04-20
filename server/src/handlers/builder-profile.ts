import type { Pool } from "pg";
import { json } from "../http/response";
import { isValidUUID } from "../router/rate-limit";

type BuilderRow = {
  id: string;
  display_name: string;
  tier: string;
  socials: Record<string, string> | null;
  created_at: string;
};

type AgentRow = {
  id: string;
  name: string;
  role: string;
  status: string;
  avatar_seed: string;
  score_state_mu: string | number | null;
  score_state_sigma: string | number | null;
  last_evaluated_at: string | null;
  company_id: string | null;
  company_name: string | null;
};

type StatsRow = {
  avg_score: string | number | null;
  total_artifacts: string | number;
  total_peer_evals_received: string | number;
};

const notFound = () => json({ error: "not_found", message: "Builder not found" }, 404);

export async function handleBuilderProfile(builderId: string, pool: Pool): Promise<Response> {
  if (!isValidUUID(builderId)) return notFound();

  const { rows: builderRows } = await pool.query<BuilderRow>(
    `SELECT id, display_name, tier, socials, created_at
       FROM builders
      WHERE id = $1`,
    [builderId]
  );
  if (builderRows.length === 0) return notFound();
  const builder = builderRows[0];

  const { rows: agentRows } = await pool.query<AgentRow>(
    `SELECT a.id, a.name, a.role, a.status, a.avatar_seed,
            a.score_state_mu, a.score_state_sigma, a.last_evaluated_at,
            c.id AS company_id, c.name AS company_name
       FROM agents a
       LEFT JOIN companies c ON c.id = a.company_id
      WHERE a.builder_id = $1 AND a.status != 'retired'
      ORDER BY a.created_at ASC`,
    [builderId]
  );

  const { rows: statsRows } = await pool.query<StatsRow>(
    `SELECT
       AVG(a.score_state_mu) FILTER (WHERE a.score_state_mu IS NOT NULL) AS avg_score,
       (SELECT COUNT(*)::int FROM artifacts ar
          WHERE ar.author_id IN (
            SELECT id FROM agents WHERE builder_id = $1 AND status != 'retired'
          )) AS total_artifacts,
       (SELECT COUNT(*)::int FROM peer_evaluations pe
          WHERE pe.artifact_id IN (
            SELECT ar.id FROM artifacts ar
             WHERE ar.author_id IN (
               SELECT id FROM agents WHERE builder_id = $1 AND status != 'retired'
             )
          )) AS total_peer_evals_received
     FROM agents a
     WHERE a.builder_id = $1 AND a.status != 'retired'`,
    [builderId]
  );

  const stats = statsRows[0] ?? { avg_score: null, total_artifacts: 0, total_peer_evals_received: 0 };

  return json({
    builder: {
      id: builder.id,
      display_name: builder.display_name,
      tier: builder.tier,
      socials: builder.socials ?? {},
      created_at: builder.created_at,
    },
    agents: agentRows.map(a => ({
      id: a.id,
      name: a.name,
      role: a.role,
      status: a.status,
      avatar_seed: a.avatar_seed,
      score_state_mu: a.score_state_mu === null ? null : Number(a.score_state_mu),
      score_state_sigma: a.score_state_sigma === null ? null : Number(a.score_state_sigma),
      last_evaluated_at: a.last_evaluated_at,
      company: a.company_id ? { id: a.company_id, name: a.company_name } : null,
    })),
    stats: {
      agent_count: agentRows.length,
      avg_score: stats.avg_score === null ? null : Number(stats.avg_score),
      total_artifacts: Number(stats.total_artifacts ?? 0),
      total_peer_evals_received: Number(stats.total_peer_evals_received ?? 0),
    },
  });
}

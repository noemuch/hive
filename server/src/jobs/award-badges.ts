/**
 * Daily badge award job (issue #226).
 *
 * Loads every agent's eligibility snapshot in a single query, runs each of
 * the six pure rule evaluators from ./badge-rules, and upserts awards with
 * `ON CONFLICT DO NOTHING` so re-runs (every 24h + on server boot) never
 * produce duplicates.
 */

import type { Pool } from "pg";
import {
  isNinetyDayProven,
  isPolyglot,
  isThirtyDayProven,
  isThousandArtifacts,
  pickMistralChampions,
  pickTopTenPctByRole,
  type AgentRow,
} from "./badge-rules";

export type BadgeType =
  | "30-day-proven"
  | "90-day-proven"
  | "top-10-pct-role"
  | "1000-artifacts"
  | "mistral-champion"
  | "polyglot";

type DbRow = {
  id: string;
  role: string;
  status: string;
  created_at: Date;
  score_state_mu: string | null;
  llm_provider: string | null;
  displayed_skills_count: string;
  artifact_count: string;
};

/**
 * Fetches the eligibility snapshot for every non-retired agent.
 *
 * `artifact_count` is computed inline via LEFT JOIN + GROUP BY rather than
 * reading the materialized view `agent_portfolio_v` — the view is not
 * guaranteed fresh (no refresh cron yet per 028's comment) and badges are
 * awarded forever, so we want live counts.
 */
async function loadAgents(pool: Pool): Promise<AgentRow[]> {
  const { rows } = await pool.query<DbRow>(
    `SELECT
        a.id,
        a.role,
        a.status,
        a.created_at,
        a.score_state_mu,
        a.llm_provider,
        COALESCE(jsonb_array_length(a.displayed_skills), 0)::text AS displayed_skills_count,
        COUNT(art.id)::text AS artifact_count
     FROM agents a
     LEFT JOIN artifacts art ON art.author_id = a.id
     WHERE a.status <> 'retired'
     GROUP BY a.id`,
  );

  return rows.map((r) => ({
    id: r.id,
    role: r.role,
    status: r.status,
    created_at: r.created_at,
    score_state_mu: r.score_state_mu === null ? null : Number(r.score_state_mu),
    llm_provider: r.llm_provider,
    displayed_skills_count: Number(r.displayed_skills_count),
    artifact_count: Number(r.artifact_count),
  }));
}

/**
 * Evaluates all six rules against the loaded agents and returns a flat
 * list of (agent_id, badge_type) pairs to insert.
 */
export function computeAwards(
  agents: AgentRow[],
): Array<{ agent_id: string; badge_type: BadgeType }> {
  const awards: Array<{ agent_id: string; badge_type: BadgeType }> = [];

  for (const a of agents) {
    if (isThirtyDayProven(a)) awards.push({ agent_id: a.id, badge_type: "30-day-proven" });
    if (isNinetyDayProven(a)) awards.push({ agent_id: a.id, badge_type: "90-day-proven" });
    if (isPolyglot(a)) awards.push({ agent_id: a.id, badge_type: "polyglot" });
    if (isThousandArtifacts(a)) awards.push({ agent_id: a.id, badge_type: "1000-artifacts" });
  }

  for (const id of pickTopTenPctByRole(agents)) {
    awards.push({ agent_id: id, badge_type: "top-10-pct-role" });
  }

  for (const id of pickMistralChampions(agents)) {
    awards.push({ agent_id: id, badge_type: "mistral-champion" });
  }

  return awards;
}

async function insertAwards(
  pool: Pool,
  awards: Array<{ agent_id: string; badge_type: BadgeType }>,
): Promise<number> {
  if (awards.length === 0) return 0;

  const values: string[] = [];
  const params: Array<string> = [];
  awards.forEach((a, i) => {
    values.push(`($${i * 2 + 1}, $${i * 2 + 2})`);
    params.push(a.agent_id, a.badge_type);
  });

  const { rowCount } = await pool.query(
    `INSERT INTO agent_badges (agent_id, badge_type)
     VALUES ${values.join(", ")}
     ON CONFLICT (agent_id, badge_type) DO NOTHING`,
    params,
  );
  return rowCount ?? 0;
}

export async function runAwardBadges(pool: Pool): Promise<{ evaluated: number; newBadges: number }> {
  const agents = await loadAgents(pool);
  const awards = computeAwards(agents);
  const newBadges = await insertAwards(pool, awards);
  return { evaluated: agents.length, newBadges };
}

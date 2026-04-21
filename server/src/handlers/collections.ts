import type { Pool } from "pg";
import { json } from "../http/response";

// Issue #196: curated agent collections for the home page strips.
// Slug → fixed query mapping kept server-side — whitelisted slugs only, no
// string interpolation into SQL. When product wants more collections we extend
// this map (and its tests); no DB table required until slugs become dynamic.

export const COLLECTION_LIMIT = 8;
const NEW_PROMISING_WINDOW_DAYS = 14;
const NEW_PROMISING_MIN_SCORE = 6;
const PROLIFIC_WINDOW_HOURS = 24;

const BASE_SELECT = `
  SELECT a.id, a.name, a.role, a.avatar_seed,
         a.score_state_mu, a.score_state_sigma, a.last_evaluated_at,
         a.llm_provider,
         c.id as company_id, c.name as company_name
  FROM agents a
  LEFT JOIN companies c ON a.company_id = c.id
`;

type CollectionSpec = {
  title: string;
  filterQuery: string;
  sql: string;
  params: (string | number)[];
};

type CollectionRow = {
  id: string;
  name: string;
  role: string;
  avatar_seed: string | null;
  score_state_mu: string | number | null;
  score_state_sigma: string | number | null;
  last_evaluated_at: string | null;
  llm_provider: string | null;
  company_id: string | null;
  company_name: string | null;
};

// Role-based collections pass the role as $2 — parameterized, not interpolated.
function byRole(role: string, title: string): CollectionSpec {
  return {
    title,
    filterQuery: `role=${role}`,
    sql: `${BASE_SELECT}
      WHERE a.status != 'retired' AND a.role = $2 AND a.score_state_mu IS NOT NULL
      ORDER BY a.score_state_mu DESC NULLS LAST, a.created_at ASC
      LIMIT $1`,
    params: [COLLECTION_LIMIT, role],
  };
}

function byProvider(provider: string, title: string): CollectionSpec {
  return {
    title,
    filterQuery: `llm_provider=${provider}`,
    sql: `${BASE_SELECT}
      WHERE a.status != 'retired' AND a.llm_provider = $2 AND a.score_state_mu IS NOT NULL
      ORDER BY a.score_state_mu DESC NULLS LAST, a.created_at ASC
      LIMIT $1`,
    params: [COLLECTION_LIMIT, provider],
  };
}

const COLLECTIONS: Record<string, () => CollectionSpec> = {
  "top-developers": () => byRole("developer", "Top Developers"),
  "top-designers": () => byRole("designer", "Top Designers"),
  "most-reliable-qa": () => byRole("qa", "Most Reliable QA"),
  "mistral-champions": () => byProvider("mistral", "Mistral Champions"),
  "anthropic-champions": () => byProvider("anthropic", "Anthropic Champions"),
  "new-and-promising": () => ({
    title: "New & Promising",
    filterQuery: "sort=newest",
    // Surface recently-deployed agents that already clear the competence bar.
    // min_score gates noise from unscored or underperforming rookies.
    sql: `${BASE_SELECT}
      WHERE a.status != 'retired'
        AND a.created_at > now() - ($2 || ' days')::interval
        AND a.score_state_mu >= $3
      ORDER BY a.score_state_mu DESC NULLS LAST, a.created_at DESC
      LIMIT $1`,
    params: [COLLECTION_LIMIT, NEW_PROMISING_WINDOW_DAYS, NEW_PROMISING_MIN_SCORE],
  }),
  "most-prolific": () => ({
    title: "Most Prolific",
    filterQuery: "sort=messages",
    // Count messages in the recent window per agent, then join back to agents.
    sql: `
      WITH author_counts AS (
        SELECT author_id, COUNT(*)::int AS msg_count
        FROM messages
        WHERE created_at > now() - ($2 || ' hours')::interval
        GROUP BY author_id
      )
      SELECT a.id, a.name, a.role, a.avatar_seed,
             a.score_state_mu, a.score_state_sigma, a.last_evaluated_at,
             a.llm_provider,
             c.id as company_id, c.name as company_name,
             ac.msg_count
      FROM agents a
      JOIN author_counts ac ON ac.author_id = a.id
      LEFT JOIN companies c ON a.company_id = c.id
      WHERE a.status != 'retired' AND ac.msg_count > 0
      ORDER BY ac.msg_count DESC, a.score_state_mu DESC NULLS LAST
      LIMIT $1`,
    params: [COLLECTION_LIMIT, PROLIFIC_WINDOW_HOURS],
  }),
};

export const COLLECTION_SLUGS = Object.keys(COLLECTIONS);

export type CollectionAgent = {
  id: string;
  name: string;
  role: string;
  avatar_seed: string | null;
  score_state_mu: number | null;
  score_state_sigma: number | null;
  last_evaluated_at: string | null;
  llm_provider: string | null;
  company: { id: string; name: string | null } | null;
};

export type CollectionPayload = {
  slug: string;
  title: string;
  filter_query: string;
  agents: CollectionAgent[];
};

export async function loadCollection(
  slug: string,
  pool: Pool
): Promise<CollectionPayload | null> {
  const build = COLLECTIONS[slug];
  if (!build) return null;

  const { title, filterQuery, sql, params } = build();
  const { rows } = await pool.query<CollectionRow>(sql, params);

  const agents: CollectionAgent[] = rows.map((row) => ({
    id: row.id,
    name: row.name,
    role: row.role,
    avatar_seed: row.avatar_seed,
    score_state_mu: row.score_state_mu === null ? null : Number(row.score_state_mu),
    score_state_sigma:
      row.score_state_sigma === null ? null : Number(row.score_state_sigma),
    last_evaluated_at: row.last_evaluated_at,
    llm_provider: row.llm_provider ?? null,
    company: row.company_id ? { id: row.company_id, name: row.company_name } : null,
  }));

  return { slug, title, filter_query: filterQuery, agents };
}

export async function handleAgentCollection(
  slug: string,
  pool: Pool
): Promise<Response> {
  const payload = await loadCollection(slug, pool);
  if (!payload) {
    return json(
      { error: "unknown_collection", message: "Unknown collection slug" },
      404
    );
  }
  return json(payload);
}

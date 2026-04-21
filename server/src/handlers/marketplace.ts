import type { Pool } from "pg";
import { json } from "../http/response";
import type { Route } from "../router/route-types";
import { logAndWrap } from "../router/middleware";

const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 100;

const VALID_ROLES = ["pm", "designer", "developer", "qa", "ops", "generalist"] as const;
const VALID_STATUSES = [
  "registered",
  "connected",
  "assigned",
  "active",
  "idle",
  "sleeping",
  "disconnected",
] as const;
const VALID_PROVIDERS = [
  "anthropic",
  "mistral",
  "deepseek",
  "openai",
  "gemini",
  "groq",
  "cerebras",
  "openrouter",
  "self-hosted",
  "other",
] as const;

interface SortConfig {
  orderBy: string;
  joinPortfolio: boolean;
}

const SORT_MAP: Record<string, SortConfig> = {
  score:           { orderBy: "a.score_state_mu DESC NULLS LAST, a.created_at ASC",         joinPortfolio: false },
  recent_activity: { orderBy: "a.last_heartbeat DESC NULLS LAST",                            joinPortfolio: false },
  artifact_count:  { orderBy: "portfolio.artifact_count DESC NULLS LAST, a.created_at ASC",  joinPortfolio: true  },
  seniority:       { orderBy: "COALESCE(a.backdated_joined_at, a.created_at) ASC",           joinPortfolio: false },
};

interface Filters {
  q: string | null;
  roles: string[] | null;
  statuses: string[] | null;
  providers: string[] | null;
  minScore: number | null;
  minHistoryDays: number | null;
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

function parseCsv(raw: string | null, allowed: readonly string[]): string[] | null {
  if (!raw) return null;
  const parts = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => allowed.includes(s));
  return parts.length ? parts : null;
}

function parseNonNegNum(raw: string | null): number | null {
  if (raw === null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function parseFilters(url: URL): Filters {
  const qRaw = (url.searchParams.get("q") ?? "").trim();
  return {
    q: qRaw.length > 0 ? qRaw : null,
    roles: parseCsv(url.searchParams.get("role"), VALID_ROLES),
    statuses: parseCsv(url.searchParams.get("status"), VALID_STATUSES),
    providers: parseCsv(url.searchParams.get("llm_provider"), VALID_PROVIDERS),
    minScore: parseNonNegNum(url.searchParams.get("min_score")),
    minHistoryDays: parseNonNegNum(url.searchParams.get("min_history_days")),
  };
}

function parseSort(raw: string | null): SortConfig {
  if (raw && Object.prototype.hasOwnProperty.call(SORT_MAP, raw)) return SORT_MAP[raw];
  return SORT_MAP.score;
}

function buildWhere(f: Filters): { sql: string; params: unknown[]; needsBuildersJoin: boolean } {
  const clauses: string[] = [`a.status != 'retired'`];
  const params: unknown[] = [];
  let needsBuildersJoin = false;

  if (f.roles) {
    params.push(f.roles);
    clauses.push(`a.role = ANY($${params.length})`);
  }
  if (f.statuses) {
    params.push(f.statuses);
    clauses.push(`a.status = ANY($${params.length})`);
  }
  if (f.providers) {
    params.push(f.providers);
    clauses.push(`a.llm_provider = ANY($${params.length})`);
  }
  if (f.minScore !== null) {
    params.push(f.minScore);
    clauses.push(`a.score_state_mu >= $${params.length}`);
  }
  if (f.minHistoryDays !== null) {
    params.push(f.minHistoryDays);
    clauses.push(
      `COALESCE(a.backdated_joined_at, a.created_at) <= now() - ($${params.length} || ' days')::interval`
    );
  }
  if (f.q) {
    needsBuildersJoin = true;
    params.push(`${f.q}%`);
    const pPrefix = params.length;
    params.push(`%${f.q}%`);
    const pSubstr = params.length;
    params.push(f.q.toLowerCase());
    const pExact = params.length;
    clauses.push(
      `(a.name ILIKE $${pPrefix}
        OR a.role ILIKE $${pSubstr}
        OR b.display_name ILIKE $${pSubstr}
        OR EXISTS (SELECT 1 FROM unnest(a.displayed_specializations) s WHERE lower(s) = $${pExact}))`
    );
  }

  return { sql: `WHERE ${clauses.join(" AND ")}`, params, needsBuildersJoin };
}

interface RowShape {
  id: string;
  name: string;
  role: string;
  avatar_seed: string;
  score_state_mu: string | number | null;
  score_state_sigma: string | number | null;
  last_evaluated_at: Date | string | null;
  llm_provider: string | null;
  brief: string | null;
  displayed_skills: unknown;
  displayed_tools: unknown;
  effective_joined_at: Date | string | null;
  company_id: string | null;
  company_name: string | null;
}

function shape(r: RowShape) {
  const mu = r.score_state_mu === null ? null : Number(r.score_state_mu);
  const sigma = r.score_state_sigma === null ? null : Number(r.score_state_sigma);
  const skills = Array.isArray(r.displayed_skills) ? r.displayed_skills : [];
  const tools = Array.isArray(r.displayed_tools) ? r.displayed_tools : [];
  const daysActive = r.effective_joined_at
    ? Math.floor((Date.now() - new Date(r.effective_joined_at).getTime()) / 86_400_000)
    : 0;
  return {
    id: r.id,
    name: r.name,
    role: r.role,
    avatar_seed: r.avatar_seed,
    score_state_mu: mu,
    score_state_sigma: sigma,
    last_evaluated_at: r.last_evaluated_at,
    llm_provider: r.llm_provider ?? null,
    // `llm_model_label` column does not yet exist on the agents table — the
    // spec lists it, so we return null as a forward-compatible placeholder
    // for the frontend contract.
    llm_model_label: null,
    displayed_skills_count: skills.length,
    displayed_tools_count: tools.length,
    company: r.company_id ? { id: r.company_id, name: r.company_name } : null,
    days_active: daysActive,
    brief: r.brief ?? null,
  };
}

export async function handleMarketplace(req: Request, pool: Pool): Promise<Response> {
  const url = new URL(req.url);
  const filters = parseFilters(url);
  const sort = parseSort(url.searchParams.get("sort"));
  const limit = clampLimit(url.searchParams.get("limit"));
  const offset = clampOffset(url.searchParams.get("offset"));

  const { sql: whereSql, params, needsBuildersJoin } = buildWhere(filters);

  const buildersJoin = needsBuildersJoin ? `LEFT JOIN builders b ON a.builder_id = b.id` : "";
  const portfolioJoin = sort.joinPortfolio
    ? `LEFT JOIN agent_portfolio_v portfolio ON portfolio.agent_id = a.id`
    : "";

  const countSql = `SELECT COUNT(*)::int AS total FROM agents a ${buildersJoin} ${whereSql}`;
  const { rows: countRows } = await pool.query(countSql, params);
  const total: number = countRows[0]?.total ?? 0;

  const limitIdx = params.length + 1;
  const offsetIdx = params.length + 2;
  const dataSql = `SELECT a.id, a.name, a.role, a.avatar_seed,
           a.score_state_mu, a.score_state_sigma, a.last_evaluated_at,
           a.llm_provider, a.personality_brief AS brief,
           a.displayed_skills, a.displayed_tools,
           COALESCE(a.backdated_joined_at, a.created_at) AS effective_joined_at,
           c.id AS company_id, c.name AS company_name
           ${sort.joinPortfolio ? ", portfolio.artifact_count" : ""}
    FROM agents a
    LEFT JOIN companies c ON a.company_id = c.id
    ${buildersJoin}
    ${portfolioJoin}
    ${whereSql}
    ORDER BY ${sort.orderBy}
    LIMIT $${limitIdx} OFFSET $${offsetIdx}`;

  const { rows } = await pool.query(dataSql, [...params, limit, offset]);
  const agents = rows.map((r) => shape(r as RowShape));

  return json({
    agents,
    total,
    has_more: offset + agents.length < total,
  });
}

export const routes: Route[] = [
  {
    method: "GET",
    path: "/api/agents/marketplace",
    handler: logAndWrap((ctx) => handleMarketplace(ctx.req, ctx.pool), "marketplace"),
  },
];

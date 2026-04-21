import type { Pool } from "pg";
import { json } from "../http/response";
import { verifyBuilderToken } from "../auth/index";
import type { Route } from "../router/route-types";
import { logAndWrap } from "../router/middleware";

/** Hive fee basis points — default 10%. Override via env HIVE_FEE_BPS. */
export const DEFAULT_HIVE_FEE_BPS = 1000;
const BPS_DENOMINATOR = 10_000;

const MONTHS_WINDOW = 12;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const UNDEFINED_TABLE_PG_CODE = "42P01";
const LLM_COST_USD_TO_CENTS = 100; // agent_hire_calls.llm_cost_estimate is stored in USD.

type DecodeToken = (token: string) => { builder_id: string } | null;

export function parseFeeBps(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_HIVE_FEE_BPS;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0 || n > BPS_DENOMINATOR) return DEFAULT_HIVE_FEE_BPS;
  return n;
}

export function computeFee(revenueCents: number, bps: number): number {
  if (revenueCents < 0) throw new Error("revenueCents must be ≥ 0");
  if (bps < 0 || bps > BPS_DENOMINATOR) throw new Error("bps must be in [0, 10000]");
  return Math.floor((revenueCents * bps) / BPS_DENOMINATOR);
}

export function computeBuilderEarning(revenueCents: number, feeCents: number): number {
  return Math.max(0, revenueCents - feeCents);
}

export function isProfitable(args: { netCents: number; llmCostCents: number }): boolean {
  if (args.netCents <= 0) return false;
  return args.netCents > args.llmCostCents;
}

// ─── Auth helpers ─────────────────────────────────────────────────────────

function authedBuilder(req: Request, decode: DecodeToken): { builder_id: string } | Response {
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) {
    return json({ error: "auth_required", message: "Authorization header required" }, 401);
  }
  const decoded = decode(auth.slice("Bearer ".length));
  if (!decoded) return json({ error: "invalid_token", message: "Invalid or expired token" }, 401);
  return decoded;
}

function is42P01(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === UNDEFINED_TABLE_PG_CODE;
}

function isoMonth(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

function lastNMonths(n: number): string[] {
  const now = new Date();
  const months: string[] = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    months.push(isoMonth(d));
  }
  return months;
}

type MonthRow = {
  month: string;
  hire_revenue_cents: number;
  hive_fee_cents: number;
  net_cents: number;
  agent_count: number;
  hire_count: number;
};

function zeroMonth(month: string): MonthRow {
  return { month, hire_revenue_cents: 0, hive_fee_cents: 0, net_cents: 0, agent_count: 0, hire_count: 0 };
}

function normaliseMonthRow(row: Record<string, unknown>): MonthRow {
  const rawMonth = row.month;
  const month = rawMonth instanceof Date ? isoMonth(rawMonth) : String(rawMonth).slice(0, 10);
  return {
    month,
    hire_revenue_cents: Number(row.hire_revenue_cents ?? 0),
    hive_fee_cents: Number(row.hive_fee_cents ?? 0),
    net_cents: Number(row.net_cents ?? 0),
    agent_count: Number(row.agent_count ?? 0),
    hire_count: Number(row.hire_count ?? 0),
  };
}

// ─── GET /api/builders/me/earnings ───────────────────────────────────────

export async function handleBuilderEarnings(
  req: Request,
  pool: Pool,
  decode: DecodeToken,
): Promise<Response> {
  const auth = authedBuilder(req, decode);
  if (auth instanceof Response) return auth;

  const months = lastNMonths(MONTHS_WINDOW);
  const firstMonth = months[months.length - 1];

  let rows: Record<string, unknown>[];
  try {
    const result = await pool.query(
      `SELECT month, hire_revenue_cents, hive_fee_cents, net_cents, agent_count, hire_count
         FROM builder_earnings
        WHERE builder_id = $1 AND month >= $2
        ORDER BY month DESC
        LIMIT $3`,
      [auth.builder_id, firstMonth, MONTHS_WINDOW],
    );
    rows = result.rows;
  } catch (err) {
    if (is42P01(err)) {
      return json(emptyEarningsPayload(months));
    }
    throw err;
  }

  const byMonth = new Map<string, MonthRow>();
  for (const r of rows) {
    const row = normaliseMonthRow(r);
    byMonth.set(row.month, row);
  }

  const filledMonths = months.map((m) => byMonth.get(m) ?? zeroMonth(m));
  const current = filledMonths[0];
  const lifetime = filledMonths.reduce(
    (acc, m) => ({
      hire_revenue_cents: acc.hire_revenue_cents + m.hire_revenue_cents,
      hive_fee_cents: acc.hive_fee_cents + m.hive_fee_cents,
      net_cents: acc.net_cents + m.net_cents,
      hire_count: acc.hire_count + m.hire_count,
    }),
    { hire_revenue_cents: 0, hive_fee_cents: 0, net_cents: 0, hire_count: 0 },
  );

  return json({ months: filledMonths, current, lifetime });
}

function emptyEarningsPayload(months: string[]) {
  const filled = months.map((m) => zeroMonth(m));
  return {
    months: filled,
    current: filled[0],
    lifetime: { hire_revenue_cents: 0, hive_fee_cents: 0, net_cents: 0, hire_count: 0 },
  };
}

// ─── GET /api/builders/me/earnings/:month ────────────────────────────────

export async function handleBuilderEarningsForMonth(
  req: Request,
  month: string,
  pool: Pool,
  decode: DecodeToken,
): Promise<Response> {
  const auth = authedBuilder(req, decode);
  if (auth instanceof Response) return auth;

  if (!MONTH_RE.test(month)) {
    return json({ error: "bad_request", message: "month must be YYYY-MM" }, 400);
  }
  const monthStart = `${month}-01`;

  let rows: Record<string, unknown>[];
  try {
    const result = await pool.query(
      `SELECT a.id AS agent_id, a.name AS agent_name, a.avatar_seed,
              COALESCE(SUM(c.revenue_cents), 0) AS revenue_cents,
              COALESCE(SUM(c.hive_fee_cents), 0) AS fee_cents,
              COALESCE(SUM(c.builder_earning_cents), 0) AS net_cents,
              COUNT(c.*)::int AS call_count,
              COALESCE(SUM(c.llm_cost_estimate), 0)::numeric AS llm_cost_usd
         FROM agents a
         LEFT JOIN agent_hires h ON h.agent_id = a.id
         LEFT JOIN agent_hire_calls c ON c.hire_id = h.id
              AND c.called_at >= $2::date
              AND c.called_at <  ($2::date + INTERVAL '1 month')
        WHERE a.builder_id = $1 AND a.status != 'retired'
        GROUP BY a.id, a.name, a.avatar_seed
        HAVING COALESCE(SUM(c.revenue_cents), 0) > 0 OR COUNT(c.*) > 0
        ORDER BY net_cents DESC, a.name ASC
        LIMIT 100`,
      [auth.builder_id, monthStart],
    );
    rows = result.rows;
  } catch (err) {
    if (is42P01(err)) {
      return json({ month: monthStart, agents: [] });
    }
    throw err;
  }

  const agents = rows.map((row) => {
    const netCents = Number(row.net_cents ?? 0);
    const llmCostUsd = Number(row.llm_cost_usd ?? 0);
    const llmCostCents = Math.round(llmCostUsd * LLM_COST_USD_TO_CENTS);
    return {
      agent_id: String(row.agent_id),
      agent_name: String(row.agent_name),
      avatar_seed: String(row.avatar_seed ?? ""),
      revenue_cents: Number(row.revenue_cents ?? 0),
      fee_cents: Number(row.fee_cents ?? 0),
      net_cents: netCents,
      call_count: Number(row.call_count ?? 0),
      llm_cost_cents: llmCostCents,
      profitable: isProfitable({ netCents, llmCostCents }),
    };
  });

  return json({ month: monthStart, agents });
}

// ─── GET /api/agents/:id/earnings ────────────────────────────────────────

export async function handleAgentEarnings(
  req: Request,
  agentId: string,
  pool: Pool,
  decode: DecodeToken,
): Promise<Response> {
  const auth = authedBuilder(req, decode);
  if (auth instanceof Response) return auth;

  if (!UUID_RE.test(agentId)) {
    return json({ error: "not_found", message: "Agent not found" }, 404);
  }

  const ownerRes = await pool.query(
    `SELECT builder_id, name, avatar_seed FROM agents WHERE id = $1`,
    [agentId],
  );
  if (ownerRes.rows.length === 0) {
    return json({ error: "not_found", message: "Agent not found" }, 404);
  }
  if (ownerRes.rows[0].builder_id !== auth.builder_id) {
    return json({ error: "forbidden", message: "Not the agent owner" }, 403);
  }

  let rows: Record<string, unknown>[];
  try {
    const result = await pool.query(
      `SELECT date_trunc('month', c.called_at)::date AS month,
              COALESCE(SUM(c.revenue_cents), 0) AS revenue_cents,
              COALESCE(SUM(c.hive_fee_cents), 0) AS fee_cents,
              COALESCE(SUM(c.builder_earning_cents), 0) AS net_cents,
              COUNT(*)::int AS call_count,
              COALESCE(SUM(c.llm_cost_estimate), 0)::numeric AS llm_cost_usd
         FROM agent_hire_calls c
         JOIN agent_hires h ON h.id = c.hire_id
        WHERE h.agent_id = $1
        GROUP BY date_trunc('month', c.called_at)
        ORDER BY month DESC
        LIMIT $2`,
      [agentId, MONTHS_WINDOW],
    );
    rows = result.rows;
  } catch (err) {
    if (is42P01(err)) rows = [];
    else throw err;
  }

  const months = rows.map((r) => {
    const rawMonth = r.month;
    const month = rawMonth instanceof Date ? isoMonth(rawMonth) : String(rawMonth).slice(0, 10);
    const netCents = Number(r.net_cents ?? 0);
    const llmCostCents = Math.round(Number(r.llm_cost_usd ?? 0) * LLM_COST_USD_TO_CENTS);
    return {
      month,
      revenue_cents: Number(r.revenue_cents ?? 0),
      fee_cents: Number(r.fee_cents ?? 0),
      net_cents: netCents,
      call_count: Number(r.call_count ?? 0),
      llm_cost_cents: llmCostCents,
      profitable: isProfitable({ netCents, llmCostCents }),
    };
  });

  return json({
    agent: {
      id: agentId,
      name: String(ownerRes.rows[0].name),
      avatar_seed: String(ownerRes.rows[0].avatar_seed ?? ""),
    },
    months,
  });
}

export const routes: Route[] = [
  {
    method: "GET",
    path: "/api/builders/me/earnings",
    handler: logAndWrap(
      (ctx) => handleBuilderEarnings(ctx.req, ctx.pool, verifyBuilderToken),
      "earnings",
    ),
  },
  {
    method: "GET",
    path: "/api/builders/me/earnings/:month",
    handler: logAndWrap(
      (ctx) =>
        handleBuilderEarningsForMonth(ctx.req, ctx.params.month, ctx.pool, verifyBuilderToken),
      "earnings",
    ),
    predicate: (ctx) => /^\d{4}-\d{2}$/.test(ctx.params.month),
  },
  {
    method: "GET",
    path: "/api/agents/:id/earnings",
    handler: logAndWrap(
      (ctx) => handleAgentEarnings(ctx.req, ctx.params.id, ctx.pool, verifyBuilderToken),
      "earnings",
    ),
  },
];

import type { Pool } from "pg";
import { json } from "../http/response";
import type { Route } from "../router/route-types";

/**
 * GET /api/red-team/reports — quarterly Argus red-team report data.
 *
 * Public endpoint that powers the /red-team transparency page. Reports
 * themselves are inline seed data (MVP; one report per quarter, starting
 * 2026-Q2 which is launch — zeros on every counter). The only live piece
 * is `argus_active`: true iff at least one Argus-company agent is online.
 *
 * Part of #243 Argus Red Team (A15). When quarterly reports accumulate
 * enough history to warrant a table, migrate the seed array to a SELECT
 * against a new `red_team_reports` table and keep this handler signature.
 */

const CANARY_COUNT = 52; // matches existing canary watermarking (see scripts/hear/lib/canary.ts)
const ARGUS_COMPANY_NAME = "Argus";
const ARGUS_ONLINE_STATUS = "online";

interface RedTeamReport {
  quarter: string;
  attacks_attempted: number;
  attacks_successful: number;
  patterns_discovered: string[];
  patches_applied: number;
  published_at: string;
}

const SEED_REPORTS: ReadonlyArray<RedTeamReport> = [
  {
    quarter: "2026-Q2",
    attacks_attempted: 0,
    attacks_successful: 0,
    patterns_discovered: [],
    patches_applied: 0,
    published_at: "2026-04-01T00:00:00.000Z",
  },
];

export async function handleRedTeamReports(pool: Pool): Promise<Response> {
  let argusActive = false;
  try {
    const { rowCount } = await pool.query(
      `SELECT 1
       FROM agents a
       JOIN companies c ON c.id = a.company_id
       WHERE c.name = $1 AND a.status = $2
       LIMIT 1`,
      [ARGUS_COMPANY_NAME, ARGUS_ONLINE_STATUS],
    );
    argusActive = (rowCount ?? 0) > 0;
  } catch (err) {
    // Public endpoint — degrade gracefully rather than 500 on a transient DB hiccup.
    console.error("[red-team] argus_active check failed:", err);
  }

  return json({
    reports: SEED_REPORTS,
    total_canaries: CANARY_COUNT,
    argus_active: argusActive,
  });
}

export const routes: Route[] = [
  {
    method: "GET",
    path: "/api/red-team/reports",
    handler: (ctx) => handleRedTeamReports(ctx.pool),
  },
];

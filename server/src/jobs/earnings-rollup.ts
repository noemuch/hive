import type { Pool } from "pg";
import { parseFeeBps, DEFAULT_HIVE_FEE_BPS } from "../handlers/builder-earnings";

// Daily rollup: settles per-call earnings on agent_hire_calls, then rolls
// monthly aggregates into builder_earnings (INSERT ... ON CONFLICT = idempotent).
// Gracefully skips when dependency tables from #220 haven't shipped yet.

const BPS_DENOMINATOR = 10_000;

export type RollupResult = {
  annotated: number;
  rollupRowCount: number;
  skipped?: "missing_table";
};

async function tableExists(pool: Pool, tableName: string): Promise<boolean> {
  const { rows } = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = $1) AS exists`,
    [tableName],
  );
  return rows.length > 0 && rows[0].exists === true;
}

export async function annotateUnsettledCalls(
  pool: Pool,
  opts: { feeBps?: number } = {},
): Promise<{ annotated: number; skipped?: "missing_table" }> {
  if (!(await tableExists(pool, "agent_hire_calls"))) {
    return { annotated: 0, skipped: "missing_table" };
  }
  const feeBps = opts.feeBps ?? DEFAULT_HIVE_FEE_BPS;
  // Compute fee + earning from the hire's agreed revenue_cents_per_call, if set.
  // Unsettled rows: settled_at IS NULL. Using LATERAL join keeps the partitioned
  // scan linear. hive_fee = revenue * bps / 10000 (integer division).
  const { rowCount } = await pool.query(
    `UPDATE agent_hire_calls c
        SET revenue_cents = h.revenue_cents_per_call,
            hive_fee_cents = (h.revenue_cents_per_call * $1) / $2,
            builder_earning_cents = h.revenue_cents_per_call
                                  - (h.revenue_cents_per_call * $1) / $2,
            settled_at = now()
       FROM agent_hires h
      WHERE c.hire_id = h.id
        AND c.settled_at IS NULL
        AND h.revenue_cents_per_call IS NOT NULL
        AND h.revenue_cents_per_call > 0`,
    [feeBps, BPS_DENOMINATOR],
  );
  return { annotated: rowCount ?? 0 };
}

async function aggregateIntoEarnings(pool: Pool): Promise<number> {
  const { rowCount } = await pool.query(
    `INSERT INTO builder_earnings (
        builder_id, month, hire_revenue_cents, hive_fee_cents, net_cents,
        agent_count, hire_count, computed_at
      )
      SELECT a.builder_id,
             date_trunc('month', c.called_at)::date AS month,
             COALESCE(SUM(c.revenue_cents), 0)           AS hire_revenue_cents,
             COALESCE(SUM(c.hive_fee_cents), 0)          AS hive_fee_cents,
             COALESCE(SUM(c.builder_earning_cents), 0)   AS net_cents,
             COUNT(DISTINCT a.id)::int                    AS agent_count,
             COUNT(DISTINCT h.id)::int                    AS hire_count,
             now()                                        AS computed_at
        FROM agent_hire_calls c
        JOIN agent_hires  h ON h.id = c.hire_id
        JOIN agents       a ON a.id = h.agent_id
       WHERE c.revenue_cents IS NOT NULL
       GROUP BY a.builder_id, date_trunc('month', c.called_at)
       ON CONFLICT (builder_id, month) DO UPDATE
         SET hire_revenue_cents = EXCLUDED.hire_revenue_cents,
             hive_fee_cents     = EXCLUDED.hive_fee_cents,
             net_cents          = EXCLUDED.net_cents,
             agent_count        = EXCLUDED.agent_count,
             hire_count         = EXCLUDED.hire_count,
             computed_at        = EXCLUDED.computed_at`,
  );
  return rowCount ?? 0;
}

export async function rollupEarnings(pool: Pool): Promise<RollupResult> {
  if (!(await tableExists(pool, "builder_earnings"))) {
    return { annotated: 0, rollupRowCount: 0, skipped: "missing_table" };
  }
  if (!(await tableExists(pool, "agent_hire_calls"))) {
    return { annotated: 0, rollupRowCount: 0, skipped: "missing_table" };
  }
  const feeBps = parseFeeBps(process.env.HIVE_FEE_BPS);
  const annotated = await annotateUnsettledCalls(pool, { feeBps });
  const rollupRowCount = await aggregateIntoEarnings(pool);
  return { annotated: annotated.annotated, rollupRowCount };
}

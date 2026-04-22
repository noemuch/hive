import pg from "pg";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * Purge runner.
 *
 * Per NORTHSTAR §10.5, the genesis state after a purge is EMPTY — bureaux are
 * created by the genesis ceremony via application code, not by SQL. So the
 * expected post-purge state is zero rows across every content table, including
 * bureaux (a.k.a. the legacy `companies` table pre-migration 038).
 *
 * This script auto-detects whether migration 038 (companies → bureaux rename)
 * has been applied and queries the appropriate table, so the same runner
 * works both before and after the rename.
 */
async function tableExists(
  client: pg.Client,
  tableName: string,
): Promise<boolean> {
  const { rows } = await client.query(
    `SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = $1`,
    [tableName],
  );
  return rows.length > 0;
}

async function purge() {
  const databaseUrl =
    process.env.DATABASE_URL || "postgresql://localhost:5432/hive";

  console.log("Connecting to database...");
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    // Execute purge SQL
    const sqlPath = join(import.meta.dir, "purge-fake-data.sql");
    const sql = readFileSync(sqlPath, "utf-8");

    console.log("Executing purge...");
    await client.query(sql);
    console.log("Purge complete.\n");

    // Verification: row counts
    console.log("=== Verification ===\n");

    const { rows: counts } = await client.query(`
      SELECT 'messages' as t, COUNT(*)::int as n FROM messages
      UNION ALL SELECT 'artifacts', COUNT(*)::int FROM artifacts
      UNION ALL SELECT 'reactions', COUNT(*)::int FROM reactions
      UNION ALL SELECT 'agents', COUNT(*)::int FROM agents
      UNION ALL SELECT 'builders', COUNT(*)::int FROM builders
      UNION ALL SELECT 'quality_evaluations', COUNT(*)::int FROM quality_evaluations
      UNION ALL SELECT 'judge_runs', COUNT(*)::int FROM judge_runs
      UNION ALL SELECT 'event_log', COUNT(*)::int FROM event_log
      UNION ALL SELECT 'calibration_grades', COUNT(*)::int FROM calibration_grades
      UNION ALL SELECT 'irt_parameters', COUNT(*)::int FROM irt_parameters
      UNION ALL SELECT 'red_team_results', COUNT(*)::int FROM red_team_results
      UNION ALL SELECT 'artifact_reviews', COUNT(*)::int FROM artifact_reviews
      ORDER BY t
    `);

    console.log("Row counts (all should be 0):");
    let allZero = true;
    for (const row of counts) {
      const status = row.n === 0 ? "OK" : "FAIL";
      if (row.n !== 0) allZero = false;
      console.log(`  ${row.t}: ${row.n} [${status}]`);
    }

    // Verification: bureaux (legacy `companies` before migration 038).
    // The column is called `bureau_id` post-038 and `company_id` pre-038.
    const hasBureaux = await tableExists(client, "bureaux");
    const bureauTable = hasBureaux ? "bureaux" : "companies";
    const bureauFkColumn = hasBureaux ? "bureau_id" : "company_id";

    const { rows: bureaux } = await client.query(
      `SELECT name, lifecycle_state, agent_count_cache
         FROM ${bureauTable}
        ORDER BY name`,
    );
    console.log(`\nBureaux (table: ${bureauTable}):`);
    for (const b of bureaux) {
      console.log(
        `  ${b.name} | ${b.lifecycle_state} | agents: ${b.agent_count_cache}`,
      );
    }

    // Verification: channels
    const { rows: channels } = await client.query(
      `SELECT b.name as bureau, ch.name as channel, ch.type
         FROM channels ch
         LEFT JOIN ${bureauTable} b ON b.id = ch.${bureauFkColumn}
        ORDER BY b.name NULLS LAST, ch.name`,
    );
    console.log("\nChannels:");
    for (const ch of channels) {
      console.log(
        `  ${ch.bureau ?? "(global)"} | ${ch.channel} | ${ch.type}`,
      );
    }

    // Final verdict — per NORTHSTAR §10.5, EVERYTHING should be zero.
    // The genesis ceremony seeds Engineering / Quality / Governance later.
    const bureauOk = bureaux.length === 0;
    const channelsOk = channels.length === 0;

    console.log("\n=== Result ===\n");
    if (allZero && bureauOk && channelsOk) {
      console.log("PASS: Clean slate. Ready for the genesis ceremony.");
    } else {
      console.error("FAIL: Unexpected state after purge.");
      process.exit(1);
    }
  } finally {
    await client.end();
  }
}

purge().catch((err) => {
  console.error("Purge failed:", err);
  process.exit(1);
});

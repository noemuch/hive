import pg from "pg";
import { readFileSync } from "fs";
import { join } from "path";

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
      UNION ALL SELECT 'reputation_history', COUNT(*)::int FROM reputation_history
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

    // Verification: companies
    const { rows: companies } = await client.query(
      "SELECT name, lifecycle_state, agent_count_cache FROM companies ORDER BY name"
    );
    console.log("\nCompanies:");
    for (const c of companies) {
      console.log(
        `  ${c.name} | ${c.lifecycle_state} | agents: ${c.agent_count_cache}`
      );
    }

    // Verification: channels
    const { rows: channels } = await client.query(`
      SELECT c.name as company, ch.name as channel, ch.type
      FROM channels ch
      LEFT JOIN companies c ON c.id = ch.company_id
      ORDER BY c.name NULLS LAST, ch.name
    `);
    console.log("\nChannels:");
    for (const ch of channels) {
      console.log(
        `  ${ch.company ?? "(global)"} | ${ch.channel} | ${ch.type}`
      );
    }

    // Final verdict
    const companyOk =
      companies.length === 1 &&
      companies[0].name === "Lyse" &&
      companies[0].lifecycle_state === "active" &&
      companies[0].agent_count_cache === 0;
    const channelsOk = channels.length === 4;

    console.log("\n=== Result ===\n");
    if (allZero && companyOk && channelsOk) {
      console.log("PASS: Clean slate. Ready for real agents.");
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

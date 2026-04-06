import { readdir } from "fs/promises";
import { join } from "path";
import pool from "./pool";

async function migrate() {
  // Create migrations tracking table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      applied_at TIMESTAMPTZ DEFAULT now()
    )
  `);

  const migrationsDir = join(import.meta.dir, "../../migrations");
  const files = (await readdir(migrationsDir))
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const { rows: applied } = await pool.query(
    "SELECT name FROM _migrations ORDER BY name"
  );
  const appliedSet = new Set(applied.map((r) => r.name));

  for (const file of files) {
    if (appliedSet.has(file)) {
      console.log(`  skip: ${file} (already applied)`);
      continue;
    }

    console.log(`  applying: ${file}`);
    const sql = await Bun.file(join(migrationsDir, file)).text();

    await pool.query("BEGIN");
    try {
      await pool.query(sql);
      await pool.query("INSERT INTO _migrations (name) VALUES ($1)", [file]);
      await pool.query("COMMIT");
      console.log(`  done: ${file}`);
    } catch (err) {
      await pool.query("ROLLBACK");
      console.error(`  FAILED: ${file}`, err);
      process.exit(1);
    }
  }

  console.log("Migrations complete.");
  await pool.end();
}

migrate();

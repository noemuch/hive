#!/usr/bin/env bun
/**
 * HEAR E13-3 — Calibration Set Backup
 *
 * Dumps calibration_set + calibration_grades to idempotent SQL.
 * Run after adding any calibration item, then commit the output.
 *
 *   bun run scripts/hear/backup-calibration.ts
 */

import pg from "pg";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dir, "..", "..");
const OUTPUT_DIR = join(PROJECT_ROOT, "docs", "research", "calibration", "backup");
const OUTPUT_PATH = join(OUTPUT_DIR, "calibration-dump.sql");

/** Escape a value for safe SQL string literal insertion. */
function pgEsc(v: string | null | undefined | Date): string {
  if (v === null || v === undefined) return "NULL";
  const s = v instanceof Date ? v.toISOString() : String(v);
  return "'" + s.replace(/'/g, "''") + "'";
}

async function main(): Promise<void> {
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL || "postgresql://localhost:5432/hive",
  });

  const client = await pool.connect();
  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ");

    const { rows: items } = await client.query<{
      id: string;
      artifact_content: string;
      artifact_type: string;
      rubric_version: string;
      added_at: Date;
    }>(
      `SELECT id, artifact_content, artifact_type, rubric_version, added_at
       FROM calibration_set
       ORDER BY added_at ASC`,
    );

    const { rows: grades } = await client.query<{
      id: string;
      calibration_id: string;
      grader_id: string;
      axis: string;
      score: number;
      justification: string | null;
      graded_at: Date;
    }>(
      `SELECT id, calibration_id, grader_id, axis, score, justification, graded_at
       FROM calibration_grades
       ORDER BY graded_at ASC`,
    );

    await client.query("COMMIT");

    const lines: string[] = [
      `-- HEAR calibration set backup — generated ${new Date().toISOString()}`,
      `-- Items: ${items.length}  Grades: ${grades.length}`,
      `-- Restore: psql $DATABASE_URL < calibration-dump.sql`,
      `-- Schema must already exist (run server migrations first).`,
      ``,
    ];

    for (const item of items) {
      lines.push(
        `INSERT INTO calibration_set (id, artifact_content, artifact_type, rubric_version, added_at) VALUES (` +
          `${pgEsc(item.id)}, ` +
          `${pgEsc(item.artifact_content)}, ` +
          `${pgEsc(item.artifact_type)}, ` +
          `${pgEsc(item.rubric_version)}, ` +
          `${pgEsc(item.added_at)}` +
          `) ON CONFLICT (id) DO NOTHING;`,
      );
    }

    lines.push("");

    for (const grade of grades) {
      lines.push(
        `INSERT INTO calibration_grades (id, calibration_id, grader_id, axis, score, justification, graded_at) VALUES (` +
          `${pgEsc(grade.id)}, ` +
          `${pgEsc(grade.calibration_id)}, ` +
          `${pgEsc(grade.grader_id)}, ` +
          `${pgEsc(grade.axis)}, ` +
          `${grade.score}, ` +
          `${pgEsc(grade.justification)}, ` +
          `${pgEsc(grade.graded_at)}` +
          `) ON CONFLICT (id) DO NOTHING;`,
      );
    }

    mkdirSync(OUTPUT_DIR, { recursive: true });
    writeFileSync(OUTPUT_PATH, lines.join("\n") + "\n");
    console.log(`✓ ${items.length} items + ${grades.length} grades → ${OUTPUT_PATH}`);

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

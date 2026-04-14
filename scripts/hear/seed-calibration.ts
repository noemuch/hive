#!/usr/bin/env bun
/**
 * HEAR — Seed calibration set + grades to the database.
 *
 * Reads docs/research/calibration/grades/grader-a.json and grader-b.json,
 * reads the 50 item files from docs/research/calibration/items/,
 * inserts rows into calibration_set and calibration_grades tables.
 *
 * Safe to re-run: skips items already present (by content hash).
 *
 * Usage:
 *   DATABASE_URL=postgresql://... bun run scripts/hear/seed-calibration.ts
 *   bun run scripts/hear/seed-calibration.ts --dry-run
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";
import { AXES, RUBRIC_VERSION, listItemIds, loadItem } from "./lib/rubric";
import type { GradesFile } from "./lib/schema";

const PROJECT_ROOT = join(import.meta.dir, "..", "..");
const GRADES_DIR = join(PROJECT_ROOT, "docs", "research", "calibration", "grades");

const DRY_RUN = process.argv.includes("--dry-run");

function loadGrades(grader: string): GradesFile {
  const path = join(GRADES_DIR, `${grader}.json`);
  if (!existsSync(path)) {
    throw new Error(
      `grades/${grader}.json not found. Run pre-grade.ts and review.ts first.`,
    );
  }
  return JSON.parse(readFileSync(path, "utf-8")) as GradesFile;
}

async function main() {
  const opusGrades = loadGrades("opus");
  const noeGrades = loadGrades("noe");

  const opusMap = new Map(opusGrades.items.map((i) => [i.item_id, i]));
  const graderBMap = new Map(noeGrades.items.map((i) => [i.item_id, i]));

  const pool = DRY_RUN
    ? null
    : new Pool({
        connectionString:
          process.env.DATABASE_URL ?? "postgresql://localhost:5432/hive",
      });

  let inserted = 0;
  let skipped = 0;
  let gradesInserted = 0;

  const allItemIds = listItemIds();

  for (const itemId of allItemIds) {
    let content: string;
    let artifactType: string;

    try {
      const item = loadItem(itemId);
      content = item.content;
      artifactType = item.type;
    } catch {
      console.warn(`  SKIP: no item file for ${itemId}`);
      continue;
    }

    const hasOpus = opusMap.has(itemId);
    const hasGraderB = graderBMap.has(itemId);
    if (!hasOpus && !hasGraderB) {
      console.warn(`  WARN: ${itemId} has no grades in any grader map — skipping`);
      skipped++;
      continue;
    }

    if (DRY_RUN) {
      console.log(`DRY-RUN: would insert ${itemId} (${artifactType})`);
      inserted++;
      continue;
    }

    // Upsert calibration_set (idempotent by content)
    const { rows } = await pool!.query<{ id: string }>(
      `INSERT INTO calibration_set (artifact_content, artifact_type, rubric_version)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [content, artifactType, RUBRIC_VERSION],
    );

    let calibId: string;
    if (rows.length === 0) {
      // Already exists — fetch id
      const { rows: existing } = await pool!.query<{ id: string }>(
        `SELECT id FROM calibration_set WHERE artifact_content = $1`,
        [content],
      );
      if (existing.length === 0) {
        console.warn(`  SKIP: could not find calibration_set row for ${itemId}`);
        skipped++;
        continue;
      }
      calibId = existing[0].id;
      skipped++;
    } else {
      calibId = rows[0].id;
      inserted++;
    }

    // Insert grades for both graders
    const graders = [
      ["claude-opus-4-6", opusMap] as const,
      ["noe", graderBMap] as const,
    ];

    for (const [graderKey, gradesMap] of graders) {
      const grade = gradesMap.get(itemId);
      if (!grade) continue;

      for (const axis of AXES) {
        const axisScore = grade.scores[axis];
        if (!axisScore || axisScore.score === null) continue;

        const { rowCount } = await pool!.query(
          `INSERT INTO calibration_grades
             (calibration_id, grader_id, axis, score, justification, graded_at)
           SELECT $1, $2, $3, $4, $5, $6
           WHERE NOT EXISTS (
             SELECT 1 FROM calibration_grades
             WHERE calibration_id = $1 AND grader_id = $2 AND axis = $3
           )`,
          [
            calibId,
            graderKey,
            axis,
            axisScore.score,
            axisScore.justification ?? "",
            grade.graded_at,
          ],
        );
        if (rowCount && rowCount > 0) gradesInserted++;
      }
    }

    console.log(`  ✓ ${itemId} (${artifactType})`);
  }

  if (pool) await pool.end();

  if (DRY_RUN) {
    console.log(
      `\nDRY-RUN: Would insert: ${inserted} items, Would skip: ${skipped}`,
    );
  } else {
    console.log(
      `\nDone. Inserted: ${inserted}, Skipped (already existed): ${skipped}, Grades inserted: ${gradesInserted}`,
    );
  }
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});

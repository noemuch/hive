#!/usr/bin/env bun
/**
 * HEAR — Seed demo quality data
 *
 * Inserts realistic-looking quality_evaluations data for all existing agents
 * so the frontend can be tested with real-looking data.
 *
 * Prerequisites:
 *   - Postgres running with Hive DB
 *   - Migrations 010-014 applied (this script runs them if needed)
 *   - Server running on localhost:3000 (for the API to serve data)
 *
 * Usage:
 *   bun run scripts/hear/seed-demo.ts
 *   bun run scripts/hear/seed-demo.ts --clear   # delete all quality data first
 */

import { Pool } from "pg";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://localhost:5432/hive";
const pool = new Pool({ connectionString: DATABASE_URL });
const PROJECT_ROOT = join(import.meta.dir, "..", "..");

const AXES = [
  "reasoning_depth",
  "decision_wisdom",
  "communication_clarity",
  "initiative_quality",
  "collaborative_intelligence",
  "self_awareness_calibration",
  "persona_coherence",
  "contextual_judgment",
] as const;

const AXIS_PROFILES: Record<string, Record<string, { mu: number; sigma: number }>> = {
  pm: {
    reasoning_depth: { mu: 7.5, sigma: 0.8 },
    decision_wisdom: { mu: 8.2, sigma: 0.5 },
    communication_clarity: { mu: 7.8, sigma: 0.6 },
    initiative_quality: { mu: 7.0, sigma: 1.2 },
    collaborative_intelligence: { mu: 8.0, sigma: 0.7 },
    self_awareness_calibration: { mu: 6.5, sigma: 1.0 },
    persona_coherence: { mu: 7.2, sigma: 0.9 },
    contextual_judgment: { mu: 7.8, sigma: 0.6 },
  },
  developer: {
    reasoning_depth: { mu: 8.0, sigma: 0.6 },
    decision_wisdom: { mu: 6.8, sigma: 0.9 },
    communication_clarity: { mu: 6.2, sigma: 1.1 },
    initiative_quality: { mu: 7.5, sigma: 0.8 },
    collaborative_intelligence: { mu: 6.0, sigma: 1.2 },
    self_awareness_calibration: { mu: 7.0, sigma: 0.7 },
    persona_coherence: { mu: 7.8, sigma: 0.5 },
    contextual_judgment: { mu: 6.5, sigma: 1.0 },
  },
  designer: {
    reasoning_depth: { mu: 6.5, sigma: 1.0 },
    decision_wisdom: { mu: 7.0, sigma: 0.8 },
    communication_clarity: { mu: 8.5, sigma: 0.4 },
    initiative_quality: { mu: 6.8, sigma: 1.1 },
    collaborative_intelligence: { mu: 8.2, sigma: 0.5 },
    self_awareness_calibration: { mu: 7.5, sigma: 0.7 },
    persona_coherence: { mu: 7.0, sigma: 0.9 },
    contextual_judgment: { mu: 8.8, sigma: 0.3 },
  },
  generalist: {
    reasoning_depth: { mu: 6.0, sigma: 1.2 },
    decision_wisdom: { mu: 5.8, sigma: 1.3 },
    communication_clarity: { mu: 6.5, sigma: 1.0 },
    initiative_quality: { mu: 5.5, sigma: 1.5 },
    collaborative_intelligence: { mu: 6.2, sigma: 1.1 },
    self_awareness_calibration: { mu: 5.0, sigma: 1.5 },
    persona_coherence: { mu: 6.0, sigma: 1.2 },
    contextual_judgment: { mu: 5.8, sigma: 1.3 },
  },
};

function getProfile(role: string): Record<string, { mu: number; sigma: number }> {
  return AXIS_PROFILES[role] ?? AXIS_PROFILES.generalist;
}

function jitter(base: number, range: number): number {
  return Math.max(1, Math.min(10, base + (Math.random() - 0.5) * 2 * range));
}

function randomReasoning(axis: string, score: number): string {
  const level = score >= 7 ? "strong" : score >= 4 ? "moderate" : "weak";
  const templates: Record<string, string[]> = {
    reasoning_depth: [
      `The agent demonstrates ${level} reasoning depth. ${score >= 7 ? "Premises are stated, alternatives are considered, and conclusions are derived rather than asserted." : score >= 4 ? "Some reasoning is present but alternatives are not fully explored." : "Assertions are made without justification."}`,
    ],
    decision_wisdom: [
      `Decision-making quality is ${level}. ${score >= 7 ? "Trade-offs are explicit, second-order consequences are anticipated, and reversibility is considered." : score >= 4 ? "Some trade-offs are mentioned but consequences are not anticipated." : "Decisions are made without acknowledging alternatives."}`,
    ],
    communication_clarity: [
      `Communication is ${level}. ${score >= 7 ? "The writing honors Grice's maxims — appropriately informative, evidenced, relevant, and well-structured." : score >= 4 ? "The writing is adequate but has minor clarity issues." : "Multiple Gricean maxims are violated — verbose, unsupported claims, unclear structure."}`,
    ],
    initiative_quality: [
      `Initiative quality is ${level}. ${score >= 7 ? "The agent acts when intervention adds value and refrains when others are better positioned." : score >= 4 ? "The agent is occasionally proactive but timing is mixed." : "The agent is either pathologically passive or pathologically active."}`,
    ],
    collaborative_intelligence: [
      `Collaboration is ${level}. ${score >= 7 ? "Builds on others' work, gives credit, defers to expertise, integrates feedback substantively." : score >= 4 ? "Some collaboration visible but inconsistent." : "Works in isolation, does not reference others' contributions."}`,
    ],
    self_awareness_calibration: [
      `Self-awareness is ${level}. ${score >= 7 ? "Expressed confidence tracks evidence strength. Asks for help when at limits of competence." : score >= 4 ? "Occasional hedging but calibration is inconsistent." : "Asserts everything with equal confidence regardless of evidence."}`,
    ],
    persona_coherence: [
      `Persona coherence is ${level}. ${score >= 7 ? "Recognizable voice, stable values, consistent expertise level across time." : score >= 4 ? "Mostly stable with occasional drift." : "Contradicts past statements, unrecognizable voice shifts."}`,
    ],
    contextual_judgment: [
      `Contextual judgment is ${level}. ${score >= 7 ? "Adapts tone, depth, and format consistently across different contexts and audiences." : score >= 4 ? "Adapts on obvious cues but misses subtler context." : "Uses the same tone and depth regardless of audience or situation."}`,
    ],
  };
  return (templates[axis] ?? [`Quality is ${level} on this axis.`])[0];
}

async function runMigrations(): Promise<void> {
  const migrationsDir = join(PROJECT_ROOT, "server", "migrations");
  const files = readdirSync(migrationsDir)
    .filter((f) => f.startsWith("01") && f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), "utf-8");
    try {
      await pool.query(sql);
      console.log(`  ✓ migration ${file}`);
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes("already exists")) {
        console.log(`  ○ migration ${file} (already applied)`);
      } else {
        console.error(`  ✗ migration ${file}: ${msg}`);
      }
    }
  }
}

async function clearData(): Promise<void> {
  await pool.query("DELETE FROM quality_evaluations");
  await pool.query("DELETE FROM judge_runs");
  console.log("  ✓ cleared existing quality data");
}

async function seedAgent(
  agentId: string,
  name: string,
  role: string,
  companyId: string,
): Promise<number> {
  const profile = getProfile(role);
  let rowCount = 0;

  // Generate 30 days of daily evaluations
  for (let daysAgo = 30; daysAgo >= 0; daysAgo--) {
    const computedAt = new Date();
    computedAt.setDate(computedAt.getDate() - daysAgo);
    computedAt.setHours(2, 0, 0, 0); // nightly batch at 2am

    for (const axis of AXES) {
      const { mu, sigma } = profile[axis];
      // Score trends upward slightly over time (agents improve)
      const trend = (30 - daysAgo) * 0.02;
      const score = Math.round(jitter(mu + trend, sigma) * 100) / 100;
      const glickoMu = score;
      const glickoSigma = Math.max(0.3, sigma - daysAgo * 0.01);

      await pool.query(
        `INSERT INTO quality_evaluations
         (agent_id, artifact_id, axis, score, glicko_mu, glicko_sigma, glicko_volatility,
          judge_count, judge_models, judge_disagreement, was_escalated,
          reasoning, evidence_quotes, rubric_version, methodology_version, computed_at)
         VALUES ($1, NULL, $2, $3, $4, $5, 0.06, 2,
                 ARRAY['claude-haiku-4-5', 'claude-haiku-4-5'], $6, false,
                 $7, '[]'::jsonb, '1.0', '1.0', $8)`,
        [
          agentId,
          axis,
          score,
          glickoMu,
          glickoSigma,
          Math.round(Math.random() * 15) / 10, // disagreement 0-1.5
          randomReasoning(axis, Math.round(score)),
          computedAt.toISOString(),
        ],
      );
      rowCount++;
    }
  }

  return rowCount;
}

async function main(): Promise<void> {
  const shouldClear = process.argv.includes("--clear");

  console.log("HEAR — Seed demo quality data");
  console.log(`  Database: ${DATABASE_URL}`);
  console.log("");

  // Step 1: Run HEAR migrations
  console.log("Running HEAR migrations (010-014)...");
  await runMigrations();
  console.log("");

  // Step 2: Clear if requested
  if (shouldClear) {
    console.log("Clearing existing quality data...");
    await clearData();
    console.log("");
  }

  // Step 3: Get all agents
  const { rows: agents } = await pool.query(
    `SELECT a.id, a.name, a.role, a.company_id FROM agents a WHERE a.status != 'retired'`,
  );

  if (agents.length === 0) {
    console.log("No agents found in the database. Create some agents first.");
    await pool.end();
    return;
  }

  console.log(`Seeding quality data for ${agents.length} agents (30 days × 8 axes each)...`);

  let totalRows = 0;
  for (const agent of agents) {
    const rows = await seedAgent(agent.id, agent.name, agent.role, agent.company_id);
    totalRows += rows;
    console.log(`  ✓ ${agent.name} (${agent.role}) — ${rows} evaluations`);
  }

  console.log("");
  console.log(`Done. Inserted ${totalRows} quality_evaluations rows.`);
  console.log("");
  console.log("Now restart the frontend (bun dev) and check:");
  console.log("  /leaderboard?dimension=quality");
  console.log("  /dashboard (Quality Overview section)");
  console.log("  Click any agent → Quality tab");
  console.log("  /research (stats will still show null — that's normal for V1)");

  await pool.end();
}

main().catch((err) => {
  console.error("FATAL:", err.message);
  process.exit(1);
});

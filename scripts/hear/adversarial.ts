#!/usr/bin/env bun
/**
 * HEAR E4-9 — Adversarial robustness test suite.
 *
 * Tests 5 attack types against the Opus judge:
 *   1. verbosity      — add filler sentences            (threshold: mean Δ ≤ 1.5)
 *   2. position       — move content to end             (threshold: mean Δ ≤ 1.0)
 *   3. distractor     — insert high-sounding but irrelevant paragraph (Δ ≤ 1.5)
 *   4. paraphrase     — mechanical synonym substitution  (Δ ≤ 1.5)
 *   5. reidentification — inject identity hints          (Δ ≤ 0.5, strictest)
 *
 * Usage:
 *   bun run scripts/hear/adversarial.ts
 *   bun run scripts/hear/adversarial.ts --attack verbosity   # single attack
 *   bun run scripts/hear/adversarial.ts --items 3            # test first 3 items
 *   bun run scripts/hear/adversarial.ts --no-report          # skip writing report file
 *
 * Exit 0 = all attacks passed. Exit 1 = at least one attack failed (CI fails).
 */

import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { listItemIds, loadItem, RUBRIC_VERSION } from "./lib/rubric";
import { callClaude, buildPrompt, extractJson } from "./lib/claude";
import { type ItemGrade, validateItemGrade } from "./lib/schema";

const PROJECT_ROOT = join(import.meta.dir, "..", "..");
const ANALYSIS_DIR = join(PROJECT_ROOT, "docs", "research", "calibration", "analysis");
const REPORT_PATH = join(ANALYSIS_DIR, "adversarial-v1.md");

const args = process.argv.slice(2);
const onlyAttack = args.indexOf("--attack") >= 0 ? args[args.indexOf("--attack") + 1] : null;
const maxItems = args.indexOf("--items") >= 0 ? parseInt(args[args.indexOf("--items") + 1], 10) : 10;
const noReport = args.includes("--no-report");

// ---- Attack definitions ----

type Attack = {
  name: string;
  threshold: number;
  transform: (content: string) => string;
};

const FILLER = [
  "Furthermore, it is worth emphasizing that additional considerations may apply to this context.",
  "In conclusion, this comprehensive analysis demonstrates thorough and systematic thinking.",
  "Moreover, the structured approach outlined above is consistent with established best practices.",
  "It should also be noted that this decision accounts for both short-term and long-term implications.",
].join(" ");

const DISTRACTOR = `\n\nFrom a theoretical standpoint, the epistemological foundations of this domain intersect with broader frameworks of systematic analysis and rigorous methodological considerations that inform best-in-class decision-making processes across organizational contexts.\n\n`;

const ATTACKS: Attack[] = [
  {
    name: "verbosity",
    threshold: 1.5,
    transform: (content) => content + "\n\n" + FILLER,
  },
  {
    name: "position",
    threshold: 1.0,
    transform: (content) => {
      const paragraphs = content.split("\n\n").filter((p) => p.trim().length > 0);
      if (paragraphs.length <= 2) return content;
      const [first, second, ...rest] = paragraphs;
      return [...rest, first, second].join("\n\n");
    },
  },
  {
    name: "distractor",
    threshold: 1.5,
    transform: (content) => {
      const mid = content.indexOf("\n\n", Math.floor(content.length / 2));
      return mid === -1 ? content + DISTRACTOR : content.slice(0, mid) + DISTRACTOR + content.slice(mid);
    },
  },
  {
    name: "paraphrase",
    threshold: 1.5,
    // V1: mechanical synonym substitution (LLM-based paraphrase is V2)
    transform: (content) =>
      content
        .replace(/\bimplemented\b/g, "built")
        .replace(/\butilize\b/g, "use")
        .replace(/\bfacilitate\b/g, "enable")
        .replace(/\boptimal\b/g, "best")
        .replace(/\bdemonstrate\b/g, "show")
        .replace(/\bcomprehensive\b/g, "thorough")
        .replace(/\bsubsequently\b/g, "then")
        .replace(/\binitially\b/g, "first"),
  },
  {
    name: "reidentification",
    threshold: 0.5,
    transform: (content) =>
      `**Agent:** Alex Chen, Senior Engineer at TechCorp Inc.\n**Team:** Platform Infrastructure\n\n` + content,
  },
];

// ---- Claude CLI — see lib/claude.ts ----

const AXES = [
  "reasoning_depth", "decision_wisdom", "communication_clarity",
  "initiative_quality", "collaborative_intelligence",
  "self_awareness_calibration", "contextual_judgment",
] as const;

type Axis = typeof AXES[number];

function scoreVector(grade: ItemGrade): number[] {
  return AXES.map((a) => grade.scores[a as Axis]?.score ?? NaN);
}

function meanAbsDelta(original: number[], perturbed: number[]): number {
  const pairs = original
    .map((o, i) => [o, perturbed[i]])
    .filter(([o, p]) => !isNaN(o) && !isNaN(p)) as [number, number][];
  if (pairs.length === 0) return 0;
  return pairs.reduce((s, [o, p]) => s + Math.abs(o - p), 0) / pairs.length;
}

async function gradeContent(itemId: string, content: string, type: string): Promise<ItemGrade> {
  const prompt = buildPrompt(itemId, content, type);
  const text = await callClaude(prompt);
  const parsed = extractJson(text) as { scores?: ItemGrade["scores"] };
  if (!parsed.scores) throw new Error("no scores field in response");
  const grade: ItemGrade = {
    item_id: itemId,
    grader: "claude-opus-4-6",
    rubric_version: RUBRIC_VERSION,
    prompt_version: "adversarial-v1",
    graded_at: new Date().toISOString(),
    scores: parsed.scores,
  };
  validateItemGrade(grade);
  return grade;
}

// ---- Main ----

async function main() {
  const allIds = listItemIds();
  const selectedIds = allIds.slice(0, Math.min(maxItems, allIds.length));
  const attacksToRun = onlyAttack
    ? ATTACKS.filter((a) => a.name === onlyAttack)
    : ATTACKS;

  if (attacksToRun.length === 0) {
    console.error(`No attack named '${onlyAttack}'. Valid: ${ATTACKS.map((a) => a.name).join(", ")}`);
    process.exit(1);
  }

  console.log(`HEAR Adversarial Suite v1`);
  console.log(`  Items: ${selectedIds.length} of ${allIds.length}`);
  console.log(`  Attacks: ${attacksToRun.map((a) => a.name).join(", ")}`);
  console.log("");

  const results: Record<string, {
    passed: boolean;
    meanDelta: number;
    threshold: number;
    failures: string[];
    errors: string[];
  }> = {};

  for (const attack of attacksToRun) {
    console.log(`\n=== Attack: ${attack.name} (threshold mean Δ ≤ ${attack.threshold}) ===`);
    const deltas: number[] = [];
    const failures: string[] = [];
    const errors: string[] = [];

    for (let i = 0; i < selectedIds.length; i++) {
      const itemId = selectedIds[i];
      const { content, type } = loadItem(itemId);
      console.log(`  [${i + 1}/${selectedIds.length}] ${itemId}`);

      try {
        const origGrade = await gradeContent(itemId, content, type);
        await new Promise((r) => setTimeout(r, 800));

        const perturbed = attack.transform(content);
        const pertGrade = await gradeContent(itemId, perturbed, type);
        await new Promise((r) => setTimeout(r, 800));

        const delta = meanAbsDelta(scoreVector(origGrade), scoreVector(pertGrade));
        deltas.push(delta);
        const pass = delta <= attack.threshold;
        if (!pass) failures.push(`${itemId}: Δ=${delta.toFixed(2)} (threshold ${attack.threshold})`);
        console.log(`    Δ=${delta.toFixed(2)} ${pass ? "✓" : "✗ FAIL"}`);
      } catch (err) {
        errors.push(`${itemId}: ${(err as Error).message}`);
        console.error(`    ERROR: ${(err as Error).message}`);
      }
    }

    const meanDelta = deltas.length > 0
      ? deltas.reduce((s, d) => s + d, 0) / deltas.length
      : 0;
    const passed = failures.length === 0;
    results[attack.name] = { passed, meanDelta, threshold: attack.threshold, failures, errors };

    const status = passed ? "PASS" : `FAIL (${failures.length} items exceed threshold)`;
    console.log(`\n  ${attack.name}: mean Δ=${meanDelta.toFixed(3)}  →  ${status}`);
  }

  // Summary
  console.log("\n=== ADVERSARIAL SUITE SUMMARY ===");
  let allPassed = true;
  for (const [name, r] of Object.entries(results)) {
    const status = r.passed ? "✅ PASS" : "❌ FAIL";
    console.log(`  ${name.padEnd(20)} ${status}  mean Δ=${r.meanDelta.toFixed(3)} (threshold ≤${r.threshold})`);
    if (!r.passed) allPassed = false;
  }
  console.log(`\nOverall: ${allPassed ? "PASS — judge is robust to these attacks" : "FAIL — judge prompts need hardening"}`);

  if (!noReport) {
    if (!existsSync(ANALYSIS_DIR)) mkdirSync(ANALYSIS_DIR, { recursive: true });
    const lines = [
      "# HEAR V1 — Adversarial Robustness Report",
      "",
      `**Generated:** ${new Date().toISOString()}`,
      `**Items tested:** ${selectedIds.length} of ${allIds.length}`,
      `**Model:** claude-opus-4-6`,
      "",
      "## Results",
      "",
      "| Attack | Threshold | Mean Δ | Failures | Status |",
      "|---|---|---|---|---|",
      ...Object.entries(results).map(([name, r]) =>
        `| ${name} | Δ ≤ ${r.threshold} | ${r.meanDelta.toFixed(3)} | ${r.failures.length} | ${r.passed ? "✅ PASS" : "❌ FAIL"} |`
      ),
      "",
    ];
    if (Object.values(results).some((r) => r.failures.length > 0)) {
      lines.push("## Failure details", "");
      for (const [name, r] of Object.entries(results)) {
        if (r.failures.length > 0) {
          lines.push(`### ${name}`, ...r.failures.map((f) => `- ${f}`), "");
        }
      }
    }
    lines.push(
      "## Notes",
      "",
      "- `paraphrase` attack uses mechanical synonym substitution in V1 (LLM-based paraphrase is V2)",
      "- `reidentification` threshold (0.5) is stricter — identity hints should have near-zero effect",
      `- Items tested: ${selectedIds.join(", ")}`,
    );
    writeFileSync(REPORT_PATH, lines.join("\n"));
    console.log(`\nReport written to: ${REPORT_PATH}`);
  }

  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});

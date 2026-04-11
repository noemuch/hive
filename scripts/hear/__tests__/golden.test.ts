import { describe, it, expect, mock, beforeAll } from "bun:test";
import type { ArtifactEvaluation } from "../lib/orchestrator";
import type { CostMonitor as CostMonitorType } from "../lib/cost";

const AXES = [
  "reasoning_depth",
  "decision_wisdom",
  "communication_clarity",
  "initiative_quality",
  "collaborative_intelligence",
  "self_awareness_calibration",
  "contextual_judgment",
] as const;

// Golden cases: calibration item → expected mean score range
const GOLDEN_CASES = [
  { itemId: "001-decision-excellent-wisdom", label: "excellent decision", minScore: 6, maxScore: 10 },
  { itemId: "004-decision-poor-no-tradeoffs", label: "poor decision", minScore: 1, maxScore: 5 },
  { itemId: "009-spec-excellent-thorough", label: "excellent spec", minScore: 6, maxScore: 10 },
  { itemId: "012-spec-poor-asserts", label: "poor spec", minScore: 1, maxScore: 5 },
  { itemId: "021-pr-average", label: "average PR", minScore: 3, maxScore: 7 },
] as const;

function targetScore(itemId: string): number {
  if (itemId.includes("excellent")) return 8;
  if (itemId.includes("poor")) return 3;
  return 5;
}

// Module-level mutable state: safe because bun:test runs describe callbacks
// sequentially within a file. Would need a ref object if tests ran concurrently.
let _mockScore = 7;

mock.module("../lib/claude-cli", () => ({
  callClaude: async () => {
    const scores: Record<string, unknown> = {};
    for (const axis of AXES) {
      scores[axis] = {
        score: _mockScore,
        justification: "golden test",
        evidence_quotes: [],
        confidence: 8,
      };
    }
    return { text: JSON.stringify({ scores }), cost: 0.05 };
  },
}));

let evaluateArtifact: (
  content: string,
  type: string,
  id: string,
  model: string,
  costTracker: InstanceType<typeof CostMonitorType>,
) => Promise<ArtifactEvaluation>;
let CostMonitor: typeof CostMonitorType;
let loadItem: (itemId: string) => { content: string; type: string };

beforeAll(async () => {
  ({ evaluateArtifact } = await import("../lib/orchestrator"));
  ({ CostMonitor } = await import("../lib/cost"));
  ({ loadItem } = await import("../lib/rubric"));
});

describe("golden fixtures", () => {
  // NOTE: callClaude is mocked — these tests verify that evaluateArtifact
  // correctly routes fixture content through the aggregation pipeline and that
  // score expectations match the fixture's quality tier. They do NOT verify
  // that real judge calls would land in the expected range; that requires
  // golden.integration.test.ts with a live ANTHROPIC_API_KEY (V2).
  for (const { itemId, label, minScore, maxScore } of GOLDEN_CASES) {
    it(`${label} (${itemId}): mean score in [${minScore}, ${maxScore}]`, async () => {
      _mockScore = targetScore(itemId);
      const { content, type } = loadItem(itemId);

      // Verify the fixture file loaded correctly — content should be non-empty
      // and type should be a known artifact type (not the fallback "unknown").
      expect(content.length).toBeGreaterThan(0);
      expect(type).not.toBe("unknown");

      const monitor = new CostMonitor({ dailyBudgetUsd: 100, monthlyBudgetUsd: 1000 });

      const result = await evaluateArtifact(content, type, itemId, "claude-opus-4-6", monitor);

      const scores = Object.values(result.axes)
        .map((a) => a.score)
        .filter((s): s is number => s !== null);

      expect(scores.length).toBeGreaterThan(0);

      const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
      expect(mean).toBeGreaterThanOrEqual(minScore);
      expect(mean).toBeLessThanOrEqual(maxScore);
    });
  }
});

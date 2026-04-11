import { describe, it, expect, mock, beforeAll } from "bun:test";
import type { ArtifactEvaluation } from "../lib/orchestrator";
import type { CostMonitor as CostMonitorType } from "../lib/cost";

// AXES as defined in rubric.ts (7 axes, persona_coherence deferred to V2)
const AXES = [
  "reasoning_depth",
  "decision_wisdom",
  "communication_clarity",
  "initiative_quality",
  "collaborative_intelligence",
  "self_awareness_calibration",
  "contextual_judgment",
] as const;

function buildScores(score: number): Record<string, unknown> {
  const scores: Record<string, unknown> = {};
  for (const axis of AXES) {
    scores[axis] = {
      score,
      justification: "test justification",
      evidence_quotes: ["quote 1"],
      confidence: 8,
    };
  }
  return scores;
}

// Mock callClaude BEFORE importing orchestrator.
mock.module("../lib/claude-cli", () => ({
  callClaude: async (_prompt: string, _model: string) => ({
    text: JSON.stringify({ scores: buildScores(7) }),
    cost: 0.05,
  }),
}));

// Dynamic imports after mock setup — required for the mock to take effect.
let evaluateArtifact: (
  content: string,
  type: string,
  id: string,
  model: string,
  costTracker: InstanceType<typeof CostMonitorType>,
) => Promise<ArtifactEvaluation>;
let CostMonitor: typeof CostMonitorType;

beforeAll(async () => {
  ({ evaluateArtifact } = await import("../lib/orchestrator"));
  ({ CostMonitor } = await import("../lib/cost"));
});

describe("evaluateArtifact", () => {
  it("returns all 7 HEAR axes", async () => {
    const monitor = new CostMonitor({ dailyBudgetUsd: 100, monthlyBudgetUsd: 1000 });
    const result = await evaluateArtifact(
      "Sample artifact content",
      "decision",
      "test-artifact-id",
      "claude-opus-4-6",
      monitor,
    );
    expect(Object.keys(result.axes).sort()).toEqual([...AXES].sort());
  });

  it("each axis has score in [1, 10]", async () => {
    const monitor = new CostMonitor({ dailyBudgetUsd: 100, monthlyBudgetUsd: 1000 });
    const result = await evaluateArtifact(
      "Sample artifact content",
      "decision",
      "test-artifact-id",
      "claude-opus-4-6",
      monitor,
    );
    for (const axis of Object.values(result.axes)) {
      if (axis.score !== null) {
        expect(axis.score).toBeGreaterThanOrEqual(1);
        expect(axis.score).toBeLessThanOrEqual(10);
      }
    }
  });

  it("judgeRuns has 14 entries — 2 judges × 7 axes", async () => {
    const monitor = new CostMonitor({ dailyBudgetUsd: 100, monthlyBudgetUsd: 1000 });
    const result = await evaluateArtifact(
      "Sample artifact content",
      "decision",
      "test-artifact-id",
      "claude-opus-4-6",
      monitor,
    );
    expect(result.judgeRuns.length).toBe(14);
  });

  it("records cost on the monitor after evaluation", async () => {
    const monitor = new CostMonitor({ dailyBudgetUsd: 100, monthlyBudgetUsd: 1000 });
    await evaluateArtifact(
      "Sample artifact content",
      "decision",
      "test-artifact-id",
      "claude-opus-4-6",
      monitor,
    );
    const snap = monitor.snapshot();
    expect(snap.callCount).toBe(2);
    expect(snap.dailySpend).toBeGreaterThan(0);
  });

  it("propagates artifactId to all judgeRuns", async () => {
    const monitor = new CostMonitor({ dailyBudgetUsd: 100, monthlyBudgetUsd: 1000 });
    const result = await evaluateArtifact(
      "Sample artifact content",
      "decision",
      "artifact-xyz",
      "claude-opus-4-6",
      monitor,
    );
    for (const run of result.judgeRuns) {
      expect(run.artifactId).toBe("artifact-xyz");
    }
  });
});

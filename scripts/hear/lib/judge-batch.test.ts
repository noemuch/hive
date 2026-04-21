import { describe, it, expect } from "bun:test";
import { evaluateArtifactsBatch } from "./judge-batch";
import type { BatchRequest, BatchResult, BatchClientOptions } from "../../../agents/lib/llm-batch";

// Patch the module's batch runner by mocking global fetch for the
// internal runBatch calls. We build fake responses that the real runBatch
// (submitBatch → pollBatch → fetchBatchResults) would go through.

function mockBatchFlow(perRequestReply: (customId: string) => string): () => void {
  const originalFetch = globalThis.fetch;
  let step = 0;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.endsWith("/messages/batches") && init?.method === "POST") {
      const body = JSON.parse((init.body as string) ?? "{}") as { requests: Array<{ custom_id: string }> };
      step = 0;
      (globalThis as unknown as { __batchReqIds: string[] }).__batchReqIds =
        body.requests.map((r) => r.custom_id);
      return new Response(JSON.stringify({ id: "batch_test" }), { status: 200 });
    }
    if (url.includes("/messages/batches/batch_test/results")) {
      const ids = (globalThis as unknown as { __batchReqIds: string[] }).__batchReqIds ?? [];
      const body = ids
        .map((cid) =>
          JSON.stringify({
            custom_id: cid,
            result: {
              type: "succeeded",
              message: { content: [{ type: "text", text: perRequestReply(cid) }] },
            },
          }),
        )
        .join("\n");
      return new Response(body, { status: 200 });
    }
    if (url.includes("/messages/batches/batch_test")) {
      // First poll: still in_progress; second: ended.
      const status = step++ === 0 ? "in_progress" : "ended";
      return new Response(
        JSON.stringify({ processing_status: status, results_url: null }),
        { status: 200 },
      );
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof globalThis.fetch;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

describe("evaluateArtifactsBatch", () => {
  it("returns [] for empty input without calling the batch API", async () => {
    const restore = mockBatchFlow(() => "");
    const result = await evaluateArtifactsBatch([], {
      model: "claude-haiku-4-5",
      apiKey: "key",
      pollIntervalMs: 1,
    });
    expect(result.evaluations).toEqual([]);
    expect(result.errorCount).toBe(0);
    expect(result.failedArtifactIds).toEqual([]);
    restore();
  });

  it("reconstructs 2-judge evaluations from a succeeded batch", async () => {
    const fakeScores = {
      reasoning_depth: { score: 7, confidence: 8, justification: "solid", evidence_quotes: ["q"] },
      decision_wisdom: { score: 6, confidence: 7, justification: "ok", evidence_quotes: [] },
    };
    const restore = mockBatchFlow((cid) => {
      // Judge A scores slightly higher than Judge B to produce disagreement.
      const bump = cid.endsWith("judge_0") ? 1 : 0;
      const scores = {
        reasoning_depth: { ...fakeScores.reasoning_depth, score: fakeScores.reasoning_depth.score + bump },
        decision_wisdom: { ...fakeScores.decision_wisdom, score: fakeScores.decision_wisdom.score + bump },
      };
      return JSON.stringify({ scores });
    });

    const result = await evaluateArtifactsBatch(
      [
        {
          artifactId: "art-1",
          artifactType: "proposal",
          prompts: ["prompt A", "prompt B"],
        },
      ],
      { model: "claude-haiku-4-5", apiKey: "k", pollIntervalMs: 1, maxWaitMs: 10_000 },
    );

    expect(result.errorCount).toBe(0);
    expect(result.failedArtifactIds).toEqual([]);
    expect(result.evaluations).toHaveLength(1);

    const ev = result.evaluations[0];
    expect(ev.artifactId).toBe("art-1");
    // Judge A: 8, Judge B: 7, mean = 7.5, rounded = 8
    expect(ev.axes.reasoning_depth.score).toBe(8);
    expect(ev.axes.reasoning_depth.judgeScores).toEqual([8, 7]);
    expect(ev.axes.reasoning_depth.disagreement).toBe(1);
    // All AXES × 2 judges judge-runs (one per axis per judge)
    const nAxes = new Set(ev.judgeRuns.map((r) => r.axis)).size;
    expect(ev.judgeRuns).toHaveLength(nAxes * 2);
    expect(nAxes).toBeGreaterThanOrEqual(2);
    // Both judges produced output → unique inputHashes (prompts differ)
    const hashes = new Set(ev.judgeRuns.map((r) => r.inputHash));
    expect(hashes.size).toBe(2);
    restore();
  });

  it("marks an artifact as failed when BOTH judges return error", async () => {
    const originalFetch = globalThis.fetch;
    let step = 0;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/messages/batches") && init?.method === "POST") {
        return new Response(JSON.stringify({ id: "batch_fail" }), { status: 200 });
      }
      if (url.includes("/results")) {
        const body = [
          JSON.stringify({
            custom_id: "art_art-bad::judge_0",
            result: { type: "errored", error: { type: "overloaded", message: "busy" } },
          }),
          JSON.stringify({
            custom_id: "art_art-bad::judge_1",
            result: { type: "errored", error: { type: "overloaded", message: "busy" } },
          }),
        ].join("\n");
        return new Response(body, { status: 200 });
      }
      const status = step++ === 0 ? "in_progress" : "ended";
      return new Response(JSON.stringify({ processing_status: status }), { status: 200 });
    }) as typeof globalThis.fetch;

    const result = await evaluateArtifactsBatch(
      [{ artifactId: "art-bad", artifactType: "x", prompts: ["a", "b"] }],
      { model: "m", apiKey: "k", pollIntervalMs: 1, maxWaitMs: 10_000 },
    );

    expect(result.failedArtifactIds).toEqual(["art-bad"]);
    expect(result.evaluations).toEqual([]);
    expect(result.errorCount).toBeGreaterThanOrEqual(2);
    globalThis.fetch = originalFetch;
  });
});

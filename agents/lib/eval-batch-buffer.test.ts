import { describe, it, expect } from "bun:test";
import { EvalBatchBuffer } from "./eval-batch-buffer";
import type { BatchRequest, BatchResult, BatchClientOptions } from "./llm-batch";

const NULL_LOGGER = {
  log: () => {},
  warn: () => {},
  error: () => {},
};

function makeReq(id: string) {
  return {
    evaluationId: id,
    systemPrompt: "sys",
    userPrompt: `prompt-${id}`,
  };
}

describe("EvalBatchBuffer", () => {
  it("flushes when queue reaches maxQueueSize", async () => {
    const submitted: BatchRequest[][] = [];
    const results: Record<string, string> = {};
    const buf = new EvalBatchBuffer({
      flushAfterMs: 60_000,
      maxQueueSize: 3,
      model: "claude-haiku-4-5",
      batchOptions: { apiKey: "test" },
      runBatchFn: async (reqs) => {
        submitted.push(reqs);
        return reqs.map((r) => ({ customId: r.customId, text: `reply-${r.customId}` }));
      },
      perRequestFallback: async () => null,
      onResult: (id, text) => { results[id] = text; },
      logger: NULL_LOGGER,
    });

    buf.enqueue(makeReq("a"));
    buf.enqueue(makeReq("b"));
    expect(buf.size()).toBe(2);
    buf.enqueue(makeReq("c"));
    // Let the microtask queue drain
    await new Promise((r) => setTimeout(r, 10));

    expect(submitted).toHaveLength(1);
    expect(submitted[0]).toHaveLength(3);
    expect(results).toEqual({
      a: "reply-a",
      b: "reply-b",
      c: "reply-c",
    });
  });

  it("flushes after flushAfterMs elapses", async () => {
    const results: Record<string, string> = {};
    const buf = new EvalBatchBuffer({
      flushAfterMs: 50,
      maxQueueSize: 100,
      model: "m",
      batchOptions: { apiKey: "k" },
      runBatchFn: async (reqs) =>
        reqs.map((r) => ({ customId: r.customId, text: `t-${r.customId}` })),
      perRequestFallback: async () => null,
      onResult: (id, text) => { results[id] = text; },
      logger: NULL_LOGGER,
    });

    buf.enqueue(makeReq("x"));
    expect(buf.size()).toBe(1);

    await new Promise((r) => setTimeout(r, 120));

    expect(results).toEqual({ x: "t-x" });
    expect(buf.size()).toBe(0);
  });

  it("falls back to per-request when the batch submission throws", async () => {
    const fallbackCalls: string[] = [];
    const results: Record<string, string> = {};
    const buf = new EvalBatchBuffer({
      flushAfterMs: 60_000,
      maxQueueSize: 2,
      model: "m",
      batchOptions: { apiKey: "k" },
      runBatchFn: async () => {
        throw new Error("provider 503");
      },
      perRequestFallback: async (_sys, userPrompt) => {
        fallbackCalls.push(userPrompt);
        return `fallback(${userPrompt})`;
      },
      onResult: (id, text) => { results[id] = text; },
      logger: NULL_LOGGER,
    });

    buf.enqueue(makeReq("1"));
    buf.enqueue(makeReq("2"));
    await new Promise((r) => setTimeout(r, 10));

    expect(fallbackCalls).toEqual(["prompt-1", "prompt-2"]);
    expect(results).toEqual({
      "1": "fallback(prompt-1)",
      "2": "fallback(prompt-2)",
    });
  });

  it("falls back per-request for individual errored items in a succeeded batch", async () => {
    const fallbackCalls: string[] = [];
    const results: Record<string, string> = {};
    const buf = new EvalBatchBuffer({
      flushAfterMs: 60_000,
      maxQueueSize: 3,
      model: "m",
      batchOptions: { apiKey: "k" },
      runBatchFn: async (reqs) =>
        reqs.map((r, i) =>
          i === 1
            ? { customId: r.customId, error: "overloaded" }
            : { customId: r.customId, text: `ok-${r.customId}` },
        ),
      perRequestFallback: async (_sys, userPrompt) => {
        fallbackCalls.push(userPrompt);
        return `retry-${userPrompt}`;
      },
      onResult: (id, text) => { results[id] = text; },
      logger: NULL_LOGGER,
    });

    buf.enqueue(makeReq("a"));
    buf.enqueue(makeReq("b"));
    buf.enqueue(makeReq("c"));
    await new Promise((r) => setTimeout(r, 10));

    expect(fallbackCalls).toEqual(["prompt-b"]);
    expect(results).toEqual({
      a: "ok-a",
      b: "retry-prompt-b",
      c: "ok-c",
    });
  });

  it("flushNow drains immediately and cancels the pending timer", async () => {
    let submitted = 0;
    const results: Record<string, string> = {};
    const buf = new EvalBatchBuffer({
      flushAfterMs: 60_000,
      maxQueueSize: 100,
      model: "m",
      batchOptions: { apiKey: "k" },
      runBatchFn: async (reqs) => {
        submitted++;
        return reqs.map((r) => ({ customId: r.customId, text: `now-${r.customId}` }));
      },
      perRequestFallback: async () => null,
      onResult: (id, text) => { results[id] = text; },
      logger: NULL_LOGGER,
    });

    buf.enqueue(makeReq("only"));
    await buf.flushNow();

    expect(submitted).toBe(1);
    expect(results).toEqual({ only: "now-only" });
  });

  it("is a no-op when flushNow is called on an empty buffer", async () => {
    let submitted = 0;
    const buf = new EvalBatchBuffer({
      flushAfterMs: 60_000,
      maxQueueSize: 10,
      model: "m",
      batchOptions: { apiKey: "k" },
      runBatchFn: async (reqs) => {
        submitted++;
        return reqs.map((r) => ({ customId: r.customId, text: "" }));
      },
      perRequestFallback: async () => null,
      onResult: () => {},
      logger: NULL_LOGGER,
    });

    await buf.flushNow();
    expect(submitted).toBe(0);
  });

  it("injects BatchClientOptions into runBatchFn unchanged", async () => {
    let seenOpts: BatchClientOptions | null = null;
    const buf = new EvalBatchBuffer({
      flushAfterMs: 60_000,
      maxQueueSize: 1,
      model: "custom-model",
      batchOptions: { apiKey: "secret", baseUrl: "https://api.anthropic.com/v1" },
      runBatchFn: async (_req, opts) => {
        seenOpts = opts;
        return [{ customId: "x", text: "ok" }];
      },
      perRequestFallback: async () => null,
      onResult: () => {},
      logger: NULL_LOGGER,
    });

    buf.enqueue(makeReq("x"));
    await new Promise((r) => setTimeout(r, 10));

    expect(seenOpts).toEqual({
      apiKey: "secret",
      baseUrl: "https://api.anthropic.com/v1",
    });
  });
});

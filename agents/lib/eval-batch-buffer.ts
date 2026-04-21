/**
 * Peer-evaluation batch buffer (agent-side).
 *
 * Coalesces `evaluate_artifact` requests that arrive over the WebSocket into
 * a single provider Batch API submission, trading a small delay for a 50%
 * per-token discount. See hive#174 for the design doc.
 *
 * Flush policy: whichever comes first,
 *   - `flushAfterMs` since the first enqueue (default 60_000)
 *   - queue reaches `maxQueueSize` (default 10)
 *
 * Failure policy: when the batch API rejects or a per-request result is an
 * error, the corresponding entries fall back to the caller-supplied
 * `perRequestFallback` (the standard `callLLM` path). This keeps the peer-
 * eval pipeline resilient to provider-side batch outages.
 */

import type { BatchRequest, BatchResult, BatchClientOptions } from "./llm-batch";

export type EvalRequest = {
  /** `peer_evaluation.id` — the server-side evaluation UUID, used as customId. */
  evaluationId: string;
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
};

export type BufferOptions = {
  flushAfterMs?: number;
  maxQueueSize?: number;
  model: string;
  batchOptions: BatchClientOptions;
  /**
   * Fire a full batch submission. Defaults to `runBatch` from `llm-batch.ts`
   * but injectable for testing.
   */
  runBatchFn?: (
    requests: BatchRequest[],
    opts: BatchClientOptions,
  ) => Promise<BatchResult[]>;
  /**
   * Per-request fallback when batch submission fails or a specific result
   * is errored. Takes the same shape as the existing `callLLM` helper and
   * must return the assistant's text (or null on persistent failure).
   */
  perRequestFallback: (
    systemPrompt: string,
    userPrompt: string,
    maxTokens: number,
  ) => Promise<string | null>;
  /** Called with the LLM text per evaluationId — caller wires this to protocol. */
  onResult: (evaluationId: string, text: string) => void;
  /** Optional logger. Defaults to console. */
  logger?: {
    log: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
};

export class EvalBatchBuffer {
  private queue: EvalRequest[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flushing = false;
  private readonly flushAfterMs: number;
  private readonly maxQueueSize: number;
  private readonly opts: BufferOptions;
  private readonly log: NonNullable<BufferOptions["logger"]>;

  constructor(opts: BufferOptions) {
    this.opts = opts;
    this.flushAfterMs = opts.flushAfterMs ?? 60_000;
    this.maxQueueSize = opts.maxQueueSize ?? 10;
    this.log = opts.logger ?? {
      log: (m) => console.log(m),
      warn: (m) => console.warn(m),
      error: (m) => console.error(m),
    };
  }

  /** Enqueue an eval request. Triggers a flush when the queue fills up. */
  enqueue(req: EvalRequest): void {
    this.queue.push(req);
    if (this.queue.length >= this.maxQueueSize) {
      this.log.log(
        `[eval-batch] size threshold reached (${this.queue.length}/${this.maxQueueSize}), flushing`,
      );
      void this.flush();
      return;
    }
    if (this.timer === null) {
      this.timer = setTimeout(() => {
        this.timer = null;
        void this.flush();
      }, this.flushAfterMs);
    }
  }

  /** Force an immediate flush (for shutdown / tests). */
  async flushNow(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.flush();
  }

  /** Current queue size — exposed for observability/tests. */
  size(): number {
    return this.queue.length;
  }

  private async flush(): Promise<void> {
    if (this.flushing) return; // reentrancy guard — batch in flight
    if (this.queue.length === 0) return;
    this.flushing = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const batch = this.queue.splice(0);
    const runBatchFn = this.opts.runBatchFn ?? (await defaultRunBatch());
    const requests: BatchRequest[] = batch.map((r) => ({
      customId: r.evaluationId,
      model: this.opts.model,
      system: r.systemPrompt,
      userContent: r.userPrompt,
      maxTokens: r.maxTokens ?? 1000,
    }));

    this.log.log(`[eval-batch] submitting batch of ${requests.length} request(s)`);
    let results: BatchResult[] = [];
    try {
      results = await runBatchFn(requests, this.opts.batchOptions);
    } catch (err) {
      this.log.warn(
        `[eval-batch] batch submission failed (${(err as Error).message}) — falling back to per-request`,
      );
      await this.runPerRequestFallback(batch);
      this.flushing = false;
      return;
    }

    // Map results back to originating requests. Any missing or errored
    // result falls back to per-request.
    const byId = new Map(results.map((r) => [r.customId, r]));
    const missing: EvalRequest[] = [];
    for (const req of batch) {
      const r = byId.get(req.evaluationId);
      if (r?.text) {
        this.opts.onResult(req.evaluationId, r.text);
      } else {
        missing.push(req);
        if (r?.error) {
          this.log.warn(
            `[eval-batch] ${req.evaluationId} errored in batch (${r.error}) — retrying per-request`,
          );
        } else {
          this.log.warn(
            `[eval-batch] ${req.evaluationId} missing from batch results — retrying per-request`,
          );
        }
      }
    }
    if (missing.length > 0) {
      await this.runPerRequestFallback(missing);
    }
    this.flushing = false;
  }

  private async runPerRequestFallback(batch: EvalRequest[]): Promise<void> {
    for (const req of batch) {
      try {
        const text = await this.opts.perRequestFallback(
          req.systemPrompt,
          req.userPrompt,
          req.maxTokens ?? 1000,
        );
        if (text) {
          this.opts.onResult(req.evaluationId, text);
        } else {
          this.log.error(`[eval-batch] fallback returned null for ${req.evaluationId}`);
        }
      } catch (err) {
        this.log.error(
          `[eval-batch] fallback failed for ${req.evaluationId}: ${(err as Error).message}`,
        );
      }
    }
  }
}

// Lazy-loaded default — avoids pulling llm-batch at module load for code that
// never enables batch mode.
let cachedDefaultRunBatch:
  | ((req: BatchRequest[], opts: BatchClientOptions) => Promise<BatchResult[]>)
  | null = null;
async function defaultRunBatch() {
  if (cachedDefaultRunBatch) return cachedDefaultRunBatch;
  const mod = await import("./llm-batch");
  cachedDefaultRunBatch = (req, opts) => mod.runBatch(req, opts);
  return cachedDefaultRunBatch;
}

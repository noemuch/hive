/**
 * LLM Batch API client — Anthropic Messages Batches.
 *
 * Anthropic, Mistral, and OpenAI all offer a Batch API at a 50% discount for
 * non-real-time workloads. This module implements the Anthropic path (the
 * first deployed provider at Hive) and exposes an extension seam
 * (`submitBatch` / `pollBatch` / `fetchBatchResults`) that other providers
 * can plug into.
 *
 * Shape for other providers (OpenAI, Mistral) will share:
 *   - submitBatch(requests) → batchId
 *   - pollBatch(batchId) → { status, resultsUrl? }
 *   - fetchBatchResults(batchId) → Array<{ customId, text | error }>
 *
 * For now, only Anthropic is wired. Callers are expected to fall back to
 * per-request calls if `batchIsSupported()` returns false.
 *
 * Scope note: this module is intentionally a pure HTTP client. Request
 * coalescing (buffer window, flush thresholds) lives in
 * `eval-batch-buffer.ts`; the judge script orchestrates its own batch flow
 * directly.
 */

export type BatchRequest = {
  customId: string;
  model: string;
  system?: string;
  /** Single user message (the common shape for peer-eval + judge). */
  userContent: string;
  maxTokens?: number;
  temperature?: number;
};

export type BatchResult = {
  customId: string;
  /** Present on success. */
  text?: string;
  /** Present on per-request error inside a succeeded batch. */
  error?: string;
};

export type BatchStatus = "in_progress" | "completed" | "failed" | "canceled";

export type BatchHandle = {
  batchId: string;
  provider: "anthropic";
};

export type BatchClientOptions = {
  /** Base URL for the batch API (defaults to LLM_BATCH_BASE_URL or Anthropic). */
  baseUrl?: string;
  /** Bearer / x-api-key for the provider. */
  apiKey: string;
};

const DEFAULT_ANTHROPIC_BASE = "https://api.anthropic.com/v1";
const ANTHROPIC_API_VERSION = "2023-06-01";
const DEFAULT_MAX_TOKENS = 1024;

/**
 * Heuristic: does the caller's LLM base URL indicate Anthropic? We need this
 * because Hive agents typically point at `api.anthropic.com/v1/openai` (the
 * OpenAI-compatibility endpoint), but the Messages Batches API lives at the
 * native `/v1/messages/batches` path. The batch client normalizes to the
 * native base when detected.
 */
export function batchIsSupported(baseUrl: string | undefined | null): boolean {
  if (!baseUrl) return true; // default path is Anthropic
  const lower = baseUrl.toLowerCase();
  return lower.includes("api.anthropic.com");
}

/** Normalize any Anthropic base URL (native or OpenAI-compat) to native. */
export function resolveAnthropicBase(baseUrl: string | undefined | null): string {
  if (!baseUrl) return DEFAULT_ANTHROPIC_BASE;
  const lower = baseUrl.toLowerCase().replace(/\/+$/, "");
  if (!lower.includes("api.anthropic.com")) return DEFAULT_ANTHROPIC_BASE;
  // Strip /openai suffix if present — batches API is not on the compat path.
  return lower.replace(/\/openai$/, "");
}

function buildHeaders(apiKey: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": ANTHROPIC_API_VERSION,
  };
}

/**
 * Submit a batch of requests to Anthropic's Messages Batches API.
 * Returns a handle that callers poll with `pollBatch`.
 */
export async function submitBatch(
  requests: BatchRequest[],
  opts: BatchClientOptions,
): Promise<BatchHandle> {
  if (requests.length === 0) {
    throw new Error("submitBatch: requests[] must not be empty");
  }
  const base = resolveAnthropicBase(opts.baseUrl);
  const payload = {
    requests: requests.map((r) => ({
      custom_id: r.customId,
      params: {
        model: r.model,
        max_tokens: r.maxTokens ?? DEFAULT_MAX_TOKENS,
        temperature: r.temperature ?? 0,
        ...(r.system ? { system: r.system } : {}),
        messages: [{ role: "user", content: r.userContent }],
      },
    })),
  };
  const res = await fetch(`${base}/messages/batches`, {
    method: "POST",
    headers: buildHeaders(opts.apiKey),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `submitBatch failed: ${res.status} ${res.statusText} — ${body.slice(0, 500)}`,
    );
  }
  const data = (await res.json()) as { id?: string };
  if (!data.id) {
    throw new Error(`submitBatch: response missing id — ${JSON.stringify(data).slice(0, 500)}`);
  }
  return { batchId: data.id, provider: "anthropic" };
}

/**
 * Poll a batch for its current status. Callers should sleep between polls —
 * 10-30s is reasonable. Anthropic batches typically complete within minutes
 * for small batches (<100 requests), up to the 24h SLA ceiling.
 */
export async function pollBatch(
  handle: BatchHandle,
  opts: BatchClientOptions,
): Promise<{ status: BatchStatus; resultsUrl?: string }> {
  const base = resolveAnthropicBase(opts.baseUrl);
  const res = await fetch(`${base}/messages/batches/${handle.batchId}`, {
    method: "GET",
    headers: buildHeaders(opts.apiKey),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `pollBatch failed: ${res.status} ${res.statusText} — ${body.slice(0, 500)}`,
    );
  }
  const data = (await res.json()) as {
    processing_status?: string;
    results_url?: string | null;
  };
  const raw = (data.processing_status ?? "").toLowerCase();
  let status: BatchStatus;
  if (raw === "in_progress" || raw === "canceling") status = "in_progress";
  else if (raw === "ended") status = "completed";
  else if (raw === "canceled") status = "canceled";
  else status = "failed";
  return { status, resultsUrl: data.results_url ?? undefined };
}

/**
 * Fetch the per-request results of a completed batch. Anthropic returns
 * JSONL (one JSON object per line) at the `results_url`. Each line has
 * `custom_id` and `result.type` in {"succeeded","errored","canceled","expired"}.
 */
export async function fetchBatchResults(
  handle: BatchHandle,
  opts: BatchClientOptions,
): Promise<BatchResult[]> {
  const base = resolveAnthropicBase(opts.baseUrl);
  const res = await fetch(`${base}/messages/batches/${handle.batchId}/results`, {
    method: "GET",
    headers: buildHeaders(opts.apiKey),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `fetchBatchResults failed: ${res.status} ${res.statusText} — ${body.slice(0, 500)}`,
    );
  }
  const body = await res.text();
  return parseJsonl(body);
}

/**
 * Parse Anthropic's batch results JSONL. Exported for unit-testability.
 * Tolerates trailing newlines and empty lines.
 */
export function parseJsonl(body: string): BatchResult[] {
  const out: BatchResult[] = [];
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed: {
      custom_id?: string;
      result?: {
        type?: string;
        message?: { content?: Array<{ type?: string; text?: string }> };
        error?: { type?: string; message?: string };
      };
    };
    try {
      parsed = JSON.parse(trimmed);
    } catch (err) {
      out.push({
        customId: "unknown",
        error: `parse error: ${(err as Error).message} — line: ${trimmed.slice(0, 200)}`,
      });
      continue;
    }
    const customId = parsed.custom_id ?? "unknown";
    const type = parsed.result?.type;
    if (type === "succeeded") {
      const text = (parsed.result?.message?.content ?? [])
        .filter((b) => b?.type === "text")
        .map((b) => b?.text ?? "")
        .join("");
      out.push({ customId, text });
    } else {
      const err =
        parsed.result?.error?.message ?? `batch request ${type ?? "failed"}`;
      out.push({ customId, error: err });
    }
  }
  return out;
}

/**
 * Convenience wrapper: submit → poll (with sleep) → fetch results. Exposes
 * a single async boundary for callers that don't need finer-grained control.
 *
 * `onProgress` is called on each poll tick with the current status — useful
 * for long-running judge batches where operators want a heartbeat log.
 */
export async function runBatch(
  requests: BatchRequest[],
  opts: BatchClientOptions & {
    pollIntervalMs?: number;
    maxWaitMs?: number;
    onProgress?: (status: BatchStatus) => void;
  },
): Promise<BatchResult[]> {
  const pollIntervalMs = opts.pollIntervalMs ?? 15_000;
  const maxWaitMs = opts.maxWaitMs ?? 24 * 60 * 60 * 1000; // 24h SLA ceiling
  const handle = await submitBatch(requests, opts);
  const start = Date.now();
  while (true) {
    const { status } = await pollBatch(handle, opts);
    opts.onProgress?.(status);
    if (status === "completed") {
      return await fetchBatchResults(handle, opts);
    }
    if (status === "failed" || status === "canceled") {
      throw new Error(`batch ${handle.batchId} ${status}`);
    }
    if (Date.now() - start > maxWaitMs) {
      throw new Error(
        `batch ${handle.batchId} exceeded maxWaitMs=${maxWaitMs}ms (still ${status})`,
      );
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
}

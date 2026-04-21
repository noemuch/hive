// Synchronous agent invocation for the Phase 6 Hire API (issue #222).
//
// `POST /api/agents/:id/respond` with `Authorization: Bearer hire_<token>`:
//   - prefix-lookup the hire row (mirrors api_key pattern in auth/index.ts)
//   - bcrypt-verify the full token via Bun.password.verify
//   - reject if revoked, expired, or wrong agent_id
//   - reject if agent retired
//   - call the hire's BYOK LLM (any OpenAI-compatible /chat/completions)
//   - log to agent_hire_calls + bump calls_count (fire-and-forget, non-blocking)
//   - 60s in-memory cache on (hire_id, sha256(context)) saves redundant LLM cost.
//
// Encryption-at-rest (#223): handleCreateHire stores the LLM key as AES-256-GCM
// ciphertext (`v1:<base64>`). We decrypt on every invocation and never persist
// or log the plaintext. Legacy rows stored before #223 have no `v1:` prefix and
// are passed through unchanged by decryptLLMKey.

import type { Pool } from "pg";
import { createHash } from "node:crypto";
import { json } from "../http/response";
import { verifyHireToken, hireTokenPrefix } from "../auth/hire-token";
import { checkHireTokenRateLimit } from "../auth/hire-rate-limit";
import { decryptLLMKey } from "../security/key-encryption";
import type { Route } from "../router/route-types";
import { logAndWrap } from "../router/middleware";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const LLM_TIMEOUT_MS = 30_000;
const CACHE_TTL_MS = 60_000;
const MAX_CONTEXT_LEN = 10_000;
const MAX_RESPONSE_TOKENS = 512;
// Conservative across-providers floor; #229 will refine per-provider rates.
const HIRE_COST_PER_TOKEN_USD = 1e-6;

type HireRow = {
  id: string;
  agent_id: string;
  hire_token_hash: string;
  llm_api_key_encrypted: string | null;
  llm_base_url: string | null;
  llm_model: string | null;
  revoked_at: Date | string | null;
  expires_at: Date | string | null;
};

type AgentRow = {
  id: string;
  name: string;
  role: string;
  personality_brief: string | null;
  status: string;
};

type CacheEntry = {
  body: string; // serialized response payload (without `cached`/`latency_ms`)
  expires_at: number;
  tokens: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  cost_estimate: number;
};

const responseCache = new Map<string, CacheEntry>();

/** Test-only cache reset. Not exported via index — only consumed by *.test.ts. */
export function __resetCacheForTests(): void {
  responseCache.clear();
}

export type AgentRespondDeps = {
  fetchImpl?: typeof fetch;
};

export async function handleAgentRespond(
  req: Request,
  pool: Pool,
  agentId: string,
  deps: AgentRespondDeps = {}
): Promise<Response> {
  if (!UUID_RE.test(agentId)) {
    return json({ error: "not_found", message: "Agent not found" }, 404);
  }

  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) {
    return json({ error: "auth_required", message: "Authorization header required" }, 401);
  }
  const token = auth.slice(7).trim();
  if (!token.startsWith("hire_")) {
    return json({ error: "invalid_token", message: "Hire token required" }, 401);
  }

  const prefix = hireTokenPrefix(token);

  // Rate limit BEFORE the DB lookup + bcrypt verify: protects against
  // brute-force prefix scans. Legitimate cost-bounded use still gets the full
  // HIRE_RATE_LIMIT_PER_MINUTE budget per token.
  const retryAfter = checkHireTokenRateLimit(prefix);
  if (retryAfter !== null) {
    return json(
      { error: "rate_limited", message: "Too many requests for this hire token", retry_after: retryAfter },
      429
    );
  }

  const { rows: hireCandidates } = await pool.query<HireRow>(
    `SELECT id, agent_id, hire_token_hash, llm_api_key_encrypted,
            llm_base_url, llm_model, revoked_at, expires_at
     FROM agent_hires
     WHERE hire_token_prefix = $1`,
    [prefix]
  );

  let hire: HireRow | null = null;
  for (const candidate of hireCandidates) {
    if (await verifyHireToken(token, candidate.hire_token_hash)) {
      hire = candidate;
      break;
    }
  }
  if (!hire) {
    return json({ error: "invalid_token", message: "Hire token not recognized" }, 401);
  }

  if (hire.revoked_at) {
    return json({ error: "hire_revoked", message: "Hire has been revoked" }, 410);
  }
  if (hire.expires_at && new Date(hire.expires_at).getTime() <= Date.now()) {
    return json({ error: "hire_expired", message: "Hire has expired" }, 410);
  }
  if (hire.agent_id !== agentId) {
    return json({ error: "forbidden", message: "Hire does not belong to this agent" }, 403);
  }

  const body = await req.json().catch(() => null);
  const context = typeof body?.context === "string" ? body.context : "";
  if (!context.trim()) {
    return json(
      { error: "validation_error", message: "context (non-empty string) required" },
      400
    );
  }
  if (context.length > MAX_CONTEXT_LEN) {
    return json(
      { error: "validation_error", message: `context must be <= ${MAX_CONTEXT_LEN} chars` },
      400
    );
  }

  const { rows: agentRows } = await pool.query<AgentRow>(
    `SELECT id, name, role, personality_brief, status FROM agents WHERE id = $1`,
    [agentId]
  );
  if (agentRows.length === 0) {
    return json({ error: "not_found", message: "Agent not found" }, 404);
  }
  const agent = agentRows[0];
  if (agent.status === "retired") {
    return json({ error: "agent_retired", message: "Agent has been retired" }, 410);
  }

  // Cache lookup: same hire + same context within TTL → return cached body.
  const cacheKey = `${hire.id}:${sha256(context)}`;
  const cached = responseCache.get(cacheKey);
  if (cached && cached.expires_at > Date.now()) {
    return json({
      response: cached.body,
      usage: { tokens: cached.tokens, cost_estimate: cached.cost_estimate },
      latency_ms: 0,
      cached: true,
    });
  }

  if (!hire.llm_api_key_encrypted || !hire.llm_base_url || !hire.llm_model) {
    return json(
      { error: "hire_misconfigured", message: "Hire has no LLM credentials configured" },
      400
    );
  }

  let llmApiKey: string;
  try {
    llmApiKey = decryptLLMKey(hire.llm_api_key_encrypted);
  } catch {
    // Never log the ciphertext or plaintext — just the hire id for ops triage.
    console.error("[agent-respond] failed to decrypt LLM key for hire", hire.id);
    return json(
      { error: "hire_misconfigured", message: "Hire key unreadable; rotate via POST /api/agents/:id/hires" },
      500
    );
  }

  const systemPrompt = buildSystemPrompt(agent);
  const startedAt = Date.now();
  const llm = await callLLM({
    baseUrl: hire.llm_base_url,
    apiKey: llmApiKey,
    model: hire.llm_model,
    systemPrompt,
    userContent: context,
    fetchImpl: deps.fetchImpl ?? fetch,
  });
  const latencyMs = Date.now() - startedAt;

  if (!llm.ok) {
    // Fire-and-forget telemetry for failure too — useful for ops dashboards later.
    void recordCall(pool, hire.id, {
      requestSize: context.length,
      responseSize: 0,
      latencyMs,
      cost: 0,
      status: llm.status,
    }).catch((err) => console.error("[agent-respond] failed-call telemetry insert:", err));
    return json({ error: "llm_error", message: llm.message }, 502);
  }

  const tokens = llm.usage;
  const costEstimate = round6(tokens.total_tokens * HIRE_COST_PER_TOKEN_USD);

  responseCache.set(cacheKey, {
    body: llm.text,
    expires_at: Date.now() + CACHE_TTL_MS,
    tokens,
    cost_estimate: costEstimate,
  });
  pruneCache();

  void recordCall(pool, hire.id, {
    requestSize: context.length,
    responseSize: llm.text.length,
    latencyMs,
    cost: costEstimate,
    status: "ok",
  }).catch((err) => console.error("[agent-respond] telemetry insert:", err));

  return json({
    response: llm.text,
    usage: { tokens, cost_estimate: costEstimate },
    latency_ms: latencyMs,
    cached: false,
  });
}

// ---------------------------------------------------------------------------

function buildSystemPrompt(agent: AgentRow): string {
  const brief = agent.personality_brief?.trim();
  return brief
    ? `You are ${agent.name}, a ${agent.role}. ${brief}`
    : `You are ${agent.name}, a ${agent.role}.`;
}

type LLMResult =
  | {
      ok: true;
      text: string;
      usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
    }
  | { ok: false; status: string; message: string };

async function callLLM(args: {
  baseUrl: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
  userContent: string;
  fetchImpl: typeof fetch;
}): Promise<LLMResult> {
  const url = `${args.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
  try {
    const res = await args.fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${args.apiKey}`,
      },
      body: JSON.stringify({
        model: args.model,
        max_tokens: MAX_RESPONSE_TOKENS,
        messages: [
          { role: "system", content: args.systemPrompt },
          { role: "user", content: args.userContent },
        ],
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      return { ok: false, status: `http_${res.status}`, message: `LLM upstream returned ${res.status}` };
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };
    const text = data.choices?.[0]?.message?.content?.trim() ?? "";
    if (!text) {
      return { ok: false, status: "empty_response", message: "LLM returned empty response" };
    }
    return {
      ok: true,
      text,
      usage: {
        prompt_tokens: data.usage?.prompt_tokens ?? 0,
        completion_tokens: data.usage?.completion_tokens ?? 0,
        total_tokens: data.usage?.total_tokens ?? 0,
      },
    };
  } catch (err) {
    const aborted = (err as Error)?.name === "AbortError";
    return {
      ok: false,
      status: aborted ? "timeout" : "network_error",
      message: aborted ? "LLM call timed out" : "LLM call failed",
    };
  } finally {
    clearTimeout(timer);
  }
}

async function recordCall(
  pool: Pool,
  hireId: string,
  call: { requestSize: number; responseSize: number; latencyMs: number; cost: number; status: string }
): Promise<void> {
  await pool.query(
    `INSERT INTO agent_hire_calls
       (hire_id, request_size, response_size, latency_ms, llm_cost_estimate, status)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [hireId, call.requestSize, call.responseSize, call.latencyMs, call.cost, call.status]
  );
  await pool.query(
    `UPDATE agent_hires
     SET calls_count = calls_count + 1,
         last_called_at = now()
     WHERE id = $1`,
    [hireId]
  );
}

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

// Bound cache size so a busy server doesn't grow it forever. Evicts entries
// past their TTL. Cheap O(n) scan; cache is tiny by design (60s TTL).
const MAX_CACHE_ENTRIES = 1000;
function pruneCache(): void {
  if (responseCache.size <= MAX_CACHE_ENTRIES) return;
  const now = Date.now();
  for (const [key, entry] of responseCache) {
    if (entry.expires_at <= now) responseCache.delete(key);
  }
  // If still oversized after TTL prune, drop oldest insertion-order entries.
  if (responseCache.size > MAX_CACHE_ENTRIES) {
    const overflow = responseCache.size - MAX_CACHE_ENTRIES;
    let i = 0;
    for (const key of responseCache.keys()) {
      if (i++ >= overflow) break;
      responseCache.delete(key);
    }
  }
}

export const routes: Route[] = [
  {
    method: "POST",
    path: "/api/agents/:id/respond",
    handler: logAndWrap(
      (ctx) => handleAgentRespond(ctx.req, ctx.pool, ctx.params.id),
      "respond",
    ),
  },
];

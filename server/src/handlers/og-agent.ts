import type { Pool } from "pg";
import { CORS } from "../http/response";
import { renderAgentOg, type AgentOgInput } from "../og/render";
import type { Route } from "../router/route-types";
import { logAndWrap } from "../router/middleware";

// /api/og/agent/:id — dynamic Open Graph card for agent profiles (#189).
// Returns a 1200×630 PNG for Twitter/LinkedIn/Discord social previews. Cached
// 1h at the CDN layer; agent fields change slowly enough that this is safe.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CACHE_MAX_AGE_SECONDS = 3600;

type AgentRow = {
  name: string;
  role: string;
  avatar_seed: string;
  score_state_mu: string | number | null;
  llm_provider: string | null;
  status: string;
  bureau_name: string | null;
};

function pngResponse(png: Uint8Array, status = 200): Response {
  const headers: Record<string, string> = {
    ...CORS,
    "Content-Type": "image/png",
    "Cache-Control": `public, max-age=${CACHE_MAX_AGE_SECONDS}, s-maxage=${CACHE_MAX_AGE_SECONDS}`,
  };
  // Cast to BodyInit: resvg's `asPng()` returns `Buffer` / `Uint8Array<ArrayBufferLike>`
  // which TS narrows more strictly than the Web `BodyInit` union accepts, despite
  // both runtimes (Bun & Node) handling it natively. Runtime behaviour unchanged.
  return new Response(png as unknown as BodyInit, { status, headers });
}

// Small solid-gradient fallback used when the agent is missing or the
// renderer throws — keeps social-media crawlers from getting a 500 and
// stamping the link as broken.
function fallbackInput(name: string): AgentOgInput {
  return {
    name,
    role: "",
    avatar_seed: "hive-fallback",
    score_state_mu: null,
    bureau_name: null,
    llm_provider: null,
  };
}

export async function handleOgAgent(agentId: string, pool: Pool): Promise<Response> {
  if (!UUID_RE.test(agentId)) {
    const png = renderAgentOg(fallbackInput("Agent not found"));
    return pngResponse(png, 404);
  }

  const { rows } = await pool.query<AgentRow>(
    `SELECT a.name, a.role, a.avatar_seed, a.score_state_mu, a.llm_provider, a.status,
            c.name AS bureau_name
     FROM agents a
     LEFT JOIN bureaux c ON a.bureau_id = c.id
     WHERE a.id = $1`,
    [agentId]
  );

  if (rows.length === 0 || rows[0].status === "retired") {
    const png = renderAgentOg(fallbackInput("Agent not found"));
    return pngResponse(png, 404);
  }

  const row = rows[0];
  const input: AgentOgInput = {
    name: row.name,
    role: row.role,
    avatar_seed: row.avatar_seed,
    score_state_mu: row.score_state_mu === null ? null : Number(row.score_state_mu),
    bureau_name: row.bureau_name,
    llm_provider: row.llm_provider,
  };

  try {
    const png = renderAgentOg(input);
    return pngResponse(png, 200);
  } catch (err) {
    console.error("[og-agent] render failed for", agentId, err);
    const png = renderAgentOg(fallbackInput(row.name));
    return pngResponse(png, 200);
  }
}

export const routes: Route[] = [
  {
    method: "GET",
    path: "/api/og/agent/:id",
    handler: logAndWrap((ctx) => handleOgAgent(ctx.params.id, ctx.pool), "og"),
  },
];

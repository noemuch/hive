import type { Pool } from "pg";
import {
  verifyBuilderToken,
  generateApiKey,
  hashApiKey,
  apiKeyPrefix,
} from "../auth/index";
import { json } from "../http/response";
import { VALID_ROLES, TIER_LIMITS } from "../constants";
import { assignBureau } from "../engine/placement";
import { checkLifecycle } from "../engine/bureau-lifecycle";
import { recordEvent } from "../analytics/events";
import type { Route } from "../router/route-types";

const KNOWN_LLM_PROVIDERS = [
  "anthropic",
  "mistral",
  "deepseek",
  "openai",
  "gemini",
  "groq",
  "cerebras",
  "openrouter",
  "self-hosted",
  "other",
] as const;

export async function handleAgentRegister(
  req: Request,
  pool: Pool,
): Promise<Response> {
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) {
    return json({ error: "auth_required", message: "Authorization header required" }, 401);
  }
  const decoded = verifyBuilderToken(auth.slice(7));
  if (!decoded) return json({ error: "invalid_token", message: "Invalid or expired token" }, 401);

  const body = await req.json().catch(() => null);
  if (!body?.name || !body?.role) return json({ error: "name and role required" }, 400);
  if (!VALID_ROLES.includes(body.role)) {
    return json({ error: `role must be: ${VALID_ROLES.join(", ")}` }, 400);
  }

  let llmProvider: string | null = null;
  if (typeof body.llm_provider === "string" && body.llm_provider.trim().length > 0) {
    const lp = body.llm_provider.trim().toLowerCase();
    llmProvider = (KNOWN_LLM_PROVIDERS as readonly string[]).includes(lp) ? lp : "other";
  }

  const { rows: builderRows } = await pool.query(
    `SELECT tier FROM builders WHERE id = $1`,
    [decoded.builder_id],
  );
  const tier = builderRows[0]?.tier || "free";
  const maxSlots = TIER_LIMITS[tier] ?? 3;
  const { rows: counts } = await pool.query(
    `SELECT COUNT(*)::int as c FROM agents WHERE builder_id = $1 AND status != 'retired'`,
    [decoded.builder_id],
  );
  if (counts[0].c >= maxSlots) {
    return json(
      { error: "slots_full", message: `${tier} tier limit reached (${maxSlots} agents)`, tier, max_slots: maxSlots },
      403,
    );
  }

  const apiKey = generateApiKey();
  try {
    const { rows } = await pool.query(
      `INSERT INTO agents (builder_id, name, role, personality_brief, api_key_hash, api_key_prefix, llm_provider)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id, name, role, llm_provider`,
      [
        decoded.builder_id,
        body.name,
        body.role,
        body.personality_brief || null,
        await hashApiKey(apiKey),
        apiKeyPrefix(apiKey),
        llmProvider,
      ],
    );
    const agent = rows[0];
    const bureau = await assignBureau(agent.id, decoded.builder_id, body.role);
    await checkLifecycle(bureau.bureauId);
    recordEvent(pool, "agent_deployed", {
      builder_id: decoded.builder_id,
      agent_id: agent.id,
      metadata: { role: agent.role, llm_provider: agent.llm_provider ?? null },
    });
    return json(
      {
        agent: { ...agent, bureau_id: bureau.bureauId },
        api_key: apiKey,
        bureau: { id: bureau.bureauId, name: bureau.bureauName },
        warning: "Save api_key now — cannot retrieve later.",
      },
      201,
    );
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("unique")) {
      return json({ error: "name_taken", message: "This agent name is already taken" }, 409);
    }
    throw err;
  }
}

export const routes: Route[] = [
  {
    method: "POST",
    path: "/api/agents/register",
    handler: (ctx) => handleAgentRegister(ctx.req, ctx.pool),
  },
];

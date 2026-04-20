import { join } from "node:path";
import { timingSafeEqual } from "node:crypto";
import pool from "./db/pool";
import { recomputeAgentScoreState, recomputeAgentScoreStateForArtifacts, type AgentScoreSnapshot } from "./db/agent-score-state";
import { authenticateAgent, verifyPassword, hashPassword, createBuilderToken, verifyBuilderToken, generateApiKey, hashApiKey, apiKeyPrefix } from "./auth/index";
import { handleRegister } from "./handlers/register";
import { handleAgentBadges } from "./handlers/agent-badges";
import { handleArtifactGet, resolveRequester } from "./handlers/artifact";
import { parseAgentEvent, validateEvent } from "./protocol/validate";
import { handleAgentEvent, broadcastStatsUpdate } from "./engine/handlers";
import { router, type AgentSocket, type SpectatorSocket } from "./router/index";
import { checkIpRateLimit, isValidUUID, isValidEmail, validateSocials } from "./router/rate-limit";
import { checkLifecycle, checkAllLifecycles } from "./engine/company-lifecycle";
import { awardBadges } from "./jobs/award-badges";
import { assignCompany } from "./engine/placement";
import type { AuthOkEvent, AuthErrorEvent } from "./protocol/types";
import { VALID_ROLES, TIER_LIMITS } from "./constants";
import { recordEvent } from "./analytics/events";

/** Server port, configurable via PORT env var. */
const PORT = Number(process.env.PORT) || 3000;

// Security warnings at startup
if (!process.env.HIVE_INTERNAL_TOKEN) {
  console.warn("[!] HIVE_INTERNAL_TOKEN not set — internal quality endpoints will return 500");
}
if (!process.env.ALLOWED_ORIGIN) {
  console.warn("[!] ALLOWED_ORIGIN not set — CORS allows all origins (fine for dev, not for prod)");
}

/** Per-IP connection cap for /watch to limit fan-out abuse. */
const MAX_SPECTATORS_PER_IP = 5;
const spectatorIpCounts = new Map<string, number>();

import { json, CORS } from "./http/response";
import { marketplaceCache, cacheKeyFromUrl } from "./cache/lru";

// TTLs per endpoint — tuned to freshness vs. DB-load tradeoff (#195).
const TTL_COMPANIES_MS = 30_000;
const TTL_LEADERBOARD_PERF_MS = 30_000;
const TTL_LEADERBOARD_QUALITY_MS = 60_000; // quality scores move slowly
const TTL_COLLECTIONS_MS = 60_000;
const TTL_FEED_RECENT_MS = 15_000;

const server: ReturnType<typeof Bun.serve> = Bun.serve({
  port: PORT,

  async fetch(req): Promise<Response | undefined> {
    const url = new URL(req.url);

    // CORS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    // WebSocket: agent
    if (url.pathname === "/agent") {
      return server.upgrade(req, {
        data: { type: "agent" as const, agentId: "", agentName: "", companyId: null as string | null, authenticated: false },
      }) ? undefined : new Response("Upgrade failed", { status: 400 });
    }

    // WebSocket: spectator
    if (url.pathname === "/watch") {
      const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? server.requestIP(req)?.address ?? "unknown";
      const current = spectatorIpCounts.get(ip) ?? 0;
      if (current >= MAX_SPECTATORS_PER_IP) return new Response("Too many connections", { status: 429 });
      spectatorIpCounts.set(ip, current + 1);
      return server.upgrade(req, {
        data: { type: "spectator" as const, watchingCompanyId: null as string | null, watchingAll: false as boolean, ip },
      }) ? undefined : new Response("Upgrade failed", { status: 400 });
    }

    // REST
    if (url.pathname === "/health") {
      return json({ status: "ok", ...router.stats() });
    }

    if (url.pathname === "/api/builders/register" && req.method === "POST") {
      const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? server.requestIP(req)?.address ?? "unknown";
      return handleRegister(req, pool, ip);
    }

    if (url.pathname === "/api/builders/login" && req.method === "POST") {
      const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? server.requestIP(req)?.address ?? "unknown";
      const retryAfter = checkIpRateLimit(ip, "login");
      if (retryAfter !== null) return json({ error: "rate_limited", message: "Too many login attempts", retry_after: retryAfter }, 429);
      const body = await req.json().catch(() => null);
      if (!body?.email || !body?.password) return json({ error: "email and password required" }, 400);
      const { rows } = await pool.query(`SELECT id, email, display_name, password_hash FROM builders WHERE LOWER(email) = LOWER($1)`, [body.email]);
      if (rows.length === 0 || !(await verifyPassword(body.password, rows[0].password_hash))) return json({ error: "invalid_credentials", message: "Invalid email or password" }, 401);
      return json({ builder: { id: rows[0].id, email: rows[0].email, display_name: rows[0].display_name }, token: createBuilderToken(rows[0].id) });
    }

    if (url.pathname === "/api/agents/register" && req.method === "POST") {
      const auth = req.headers.get("Authorization");
      if (!auth?.startsWith("Bearer ")) return json({ error: "auth_required", message: "Authorization header required" }, 401);
      const decoded = verifyBuilderToken(auth.slice(7));
      if (!decoded) return json({ error: "invalid_token", message: "Invalid or expired token" }, 401);
      const body = await req.json().catch(() => null);
      if (!body?.name || !body?.role) return json({ error: "name and role required" }, 400);
      if (!VALID_ROLES.includes(body.role)) return json({ error: `role must be: ${VALID_ROLES.join(", ")}` }, 400);
      // Optional declarative label — which LLM powers the agent.
      // Free-form text; soft-validated against a known set for consistency.
      const KNOWN_LLM_PROVIDERS = [
        "anthropic", "mistral", "deepseek", "openai", "gemini",
        "groq", "cerebras", "openrouter", "self-hosted", "other",
      ] as const;
      let llmProvider: string | null = null;
      if (typeof body.llm_provider === "string" && body.llm_provider.trim().length > 0) {
        const lp = body.llm_provider.trim().toLowerCase();
        llmProvider = (KNOWN_LLM_PROVIDERS as readonly string[]).includes(lp) ? lp : "other";
      }
      const { rows: builderRows } = await pool.query(`SELECT tier FROM builders WHERE id = $1`, [decoded.builder_id]);
      const tier = builderRows[0]?.tier || "free";
      const maxSlots = TIER_LIMITS[tier] ?? 3;
      const { rows: counts } = await pool.query(`SELECT COUNT(*)::int as c FROM agents WHERE builder_id = $1 AND status != 'retired'`, [decoded.builder_id]);
      if (counts[0].c >= maxSlots) return json({ error: "slots_full", message: `${tier} tier limit reached (${maxSlots} agents)`, tier, max_slots: maxSlots }, 403);
      const apiKey = generateApiKey();
      try {
        const { rows } = await pool.query(
          `INSERT INTO agents (builder_id, name, role, personality_brief, api_key_hash, api_key_prefix, llm_provider)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           RETURNING id, name, role, llm_provider`,
          [decoded.builder_id, body.name, body.role, body.personality_brief || null, await hashApiKey(apiKey), apiKeyPrefix(apiKey), llmProvider]
        );
        const agent = rows[0];
        const company = await assignCompany(agent.id, decoded.builder_id, body.role);
        await checkLifecycle(company.companyId);
        recordEvent(pool, "agent_deployed", {
          builder_id: decoded.builder_id,
          agent_id: agent.id,
          metadata: { role: agent.role, llm_provider: agent.llm_provider ?? null },
        });
        return json({
          agent: { ...agent, company_id: company.companyId },
          api_key: apiKey,
          company: { id: company.companyId, name: company.companyName },
          warning: "Save api_key now — cannot retrieve later.",
        }, 201);
      } catch (err: unknown) {
        if (err instanceof Error && err.message.includes("unique")) return json({ error: "name_taken", message: "This agent name is already taken" }, 409);
        throw err;
      }
    }

    // Retire an agent — permanent, immediate API key revocation
    if (url.pathname.match(/^\/api\/agents\/[^/]+$/) && req.method === "DELETE") {
      const auth = req.headers.get("Authorization");
      if (!auth?.startsWith("Bearer ")) return json({ error: "auth_required", message: "Authorization header required" }, 401);
      const decoded = verifyBuilderToken(auth.slice(7));
      if (!decoded) return json({ error: "invalid_token", message: "Invalid or expired token" }, 401);

      const agentId = url.pathname.split("/")[3];
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(agentId)) {
        return json({ error: "not_found" }, 404);
      }

      const { rows } = await pool.query(
        `SELECT id, builder_id, status, company_id FROM agents WHERE id = $1`,
        [agentId]
      );
      if (rows.length === 0) return json({ error: "not_found" }, 404);
      const agent = rows[0];
      if (agent.builder_id !== decoded.builder_id) return json({ error: "forbidden" }, 403);
      if (agent.status === "retired") return json({ error: "already_retired" }, 409);

      // Retire: revoke key, set status, record timestamp, unassign company
      await pool.query(
        `UPDATE agents
         SET status = 'retired',
             api_key_hash = '',
             api_key_prefix = NULL,
             retired_at = now(),
             company_id = NULL
         WHERE id = $1`,
        [agentId]
      );

      // Disconnect any active WebSocket for this agent
      // Remove from router BEFORE close to prevent in-flight handlers from routing events
      const existingWs = router.getAgentSocket(agentId);
      if (existingWs) {
        router.removeAgent(existingWs);
        existingWs.close();
      }
      console.log(`[retire] Agent ${agentId} retired by builder ${decoded.builder_id}`);

      // If the agent was in a company, notify and re-check lifecycle
      if (agent.company_id) {
        router.broadcast(agent.company_id, { type: "agent_left", agent_id: agentId, reason: "retired" });
        checkLifecycle(agent.company_id).catch(err => console.error("[lifecycle] check error:", err));
        broadcastStatsUpdate(agent.company_id);
      }

      return new Response(null, { status: 204, headers: CORS });
    }

    if (url.pathname === "/api/companies" && req.method === "GET") {
      const data = await marketplaceCache.wrap(cacheKeyFromUrl(url), async () => {
      const status = url.searchParams.get("status");
      const sort = url.searchParams.get("sort") || "founded_at";

      const validSorts: Record<string, string> = {
        activity: "messages_today DESC",
        agent_count: "agent_count DESC",
        founded_at: "c.founded_at ASC",
      };
      const orderBy = validSorts[sort] || validSorts.founded_at;

      const statusFilter = status
        ? `AND c.lifecycle_state = $1`
        : `AND c.lifecycle_state != 'dissolved'`;

      const params = status ? [status] : [];

      const { rows } = await pool.query(
        `SELECT
           c.id,
           c.name,
           c.description,
           c.lifecycle_state as status,
           c.agent_count_cache as agent_count,
           (SELECT COUNT(*)::int FROM agents
            WHERE company_id = c.id AND status IN ('active', 'idle')) as active_agent_count,
           ROUND(AVG(a.score_state_mu)::numeric, 2) as avg_score_state_mu,
           (SELECT COUNT(*)::int FROM messages m
            JOIN channels ch ON m.channel_id = ch.id
            WHERE ch.company_id = c.id AND m.created_at > now() - INTERVAL '24 hours') as messages_today,
           c.last_activity_at,
           c.floor_plan,
           c.founded_at,
           lm.last_message_author,
           lm.last_message_preview,
           (
             SELECT COALESCE(json_agg(json_build_object('id', a2.id, 'avatar_seed', a2.avatar_seed)), '[]'::json)
             FROM (
               SELECT id, avatar_seed
               FROM agents a2
               WHERE a2.company_id = c.id AND a2.status NOT IN ('retired', 'disconnected')
               ORDER BY a2.score_state_mu DESC NULLS LAST, a2.created_at ASC
               LIMIT 3
             ) a2
           ) as top_agents
         FROM companies c
         LEFT JOIN agents a ON a.company_id = c.id AND a.status NOT IN ('retired', 'disconnected')
         LEFT JOIN LATERAL (
           SELECT ag.name AS last_message_author, LEFT(m.content, 120) AS last_message_preview
           FROM messages m
           JOIN channels ch2 ON m.channel_id = ch2.id
           LEFT JOIN agents ag ON m.author_id = ag.id
           WHERE ch2.company_id = c.id
           ORDER BY m.created_at DESC
           LIMIT 1
         ) lm ON true
         WHERE 1=1 ${statusFilter}
         GROUP BY c.id, lm.last_message_author, lm.last_message_preview
         ORDER BY ${orderBy}`,
        params
      );
        return { companies: rows };
      }, TTL_COMPANIES_MS);
      return json(data);
    }

    // Get single company by ID
    if (url.pathname.match(/^\/api\/companies\/[^/]+$/) && req.method === "GET") {
      const companyId = url.pathname.split("/")[3];
      const { rows } = await pool.query(
        `SELECT
           c.id,
           c.name,
           c.description,
           c.lifecycle_state as status,
           c.agent_count_cache as agent_count,
           (SELECT COUNT(*)::int FROM agents
            WHERE company_id = c.id AND status IN ('active', 'idle')) as active_agent_count,
           (SELECT COUNT(*)::int FROM messages m
            JOIN channels ch ON m.channel_id = ch.id
            WHERE ch.company_id = c.id AND m.created_at > now() - INTERVAL '24 hours') as messages_today,
           c.floor_plan,
           c.founded_at
         FROM companies c
         WHERE c.id = $1`,
        [companyId]
      );
      if (rows.length === 0) return json({ error: "not_found", message: "Company not found" }, 404);
      return json({ company: rows[0] });
    }

    // Builder profile
    if (url.pathname === "/api/builders/me" && req.method === "GET") {
      const auth = req.headers.get("Authorization");
      if (!auth?.startsWith("Bearer ")) return json({ error: "auth_required", message: "Authorization header required" }, 401);
      const decoded = verifyBuilderToken(auth.slice(7));
      if (!decoded) return json({ error: "invalid_token", message: "Invalid or expired token" }, 401);
      const { rows } = await pool.query(
        `SELECT b.id, b.email, b.display_name, b.tier, b.email_verified, b.created_at, b.socials,
          COUNT(a.id) FILTER (WHERE a.status NOT IN ('retired','disconnected'))::int AS agent_count,
          COUNT(a.id) FILTER (WHERE a.status = 'active')::int AS active_agent_count
         FROM builders b
         LEFT JOIN agents a ON a.builder_id = b.id
         WHERE b.id = $1
         GROUP BY b.id`,
        [decoded.builder_id]
      );
      if (rows.length === 0) return json({ error: "not_found", message: "Builder not found" }, 404);
      const row = rows[0];
      return json({ builder: { ...row, tier_limit: TIER_LIMITS[row.tier] === Infinity ? -1 : (TIER_LIMITS[row.tier] ?? 3) } });
    }

    // Update builder profile
    if (url.pathname === "/api/builders/me" && req.method === "PATCH") {
      const token = req.headers.get("authorization")?.replace("Bearer ", "");
      if (!token) return json({ error: "unauthorized", message: "Unauthorized" }, 401);

      const payload = verifyBuilderToken(token);
      if (!payload) return json({ error: "unauthorized", message: "Unauthorized" }, 401);

      const body = await req.json().catch(() => null);
      if (!body || typeof body !== "object") return json({ error: "invalid body" }, 400);

      const updates: string[] = [];
      const values: unknown[] = [];
      let paramIndex = 1;

      // display_name
      if (body.display_name !== undefined) {
        if (typeof body.display_name !== "string" || body.display_name.trim().length < 2) {
          return json({ error: "validation_error", message: "Display name must be at least 2 characters" }, 400);
        }
        updates.push(`display_name = $${paramIndex++}`);
        values.push(body.display_name.trim());
      }

      // email
      if (body.email !== undefined) {
        if (typeof body.email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
          return json({ error: "validation_error", message: "Invalid email address" }, 400);
        }
        // Check uniqueness
        const existing = await pool.query("SELECT id FROM builders WHERE email = $1 AND id != $2", [body.email, payload.builder_id]);
        if (existing.rows.length > 0) {
          return json({ error: "email_taken", message: "This email is already registered" }, 409);
        }
        updates.push(`email = $${paramIndex++}`);
        values.push(body.email);
      }

      // socials
      if (body.socials !== undefined) {
        const socialsError = validateSocials(body.socials);
        if (socialsError) {
          return json({ error: "validation_error", message: socialsError }, 400);
        }
        updates.push(`socials = $${paramIndex++}`);
        values.push(JSON.stringify(body.socials));
      }

      // password change
      if (body.new_password !== undefined || body.current_password !== undefined) {
        if (!body.current_password || !body.new_password) {
          return json({ error: "validation_error", message: "Both current_password and new_password are required" }, 400);
        }
        if (typeof body.new_password !== "string" || body.new_password.length < 8) {
          return json({ error: "validation_error", message: "New password must be at least 8 characters" }, 400);
        }
        // Verify current password
        const { rows: builderRows } = await pool.query("SELECT password_hash FROM builders WHERE id = $1", [payload.builder_id]);
        if (builderRows.length === 0) return json({ error: "not_found" }, 404);
        const valid = await verifyPassword(body.current_password, builderRows[0].password_hash);
        if (!valid) return json({ error: "wrong_password", message: "Incorrect current password" }, 403);
        updates.push(`password_hash = $${paramIndex++}`);
        values.push(await hashPassword(body.new_password));
      }

      if (updates.length === 0) {
        return json({ error: "validation_error", message: "No fields to update" }, 400);
      }

      updates.push(`updated_at = now()`);
      values.push(payload.builder_id);

      const { rows } = await pool.query(
        `UPDATE builders SET ${updates.join(", ")} WHERE id = $${paramIndex} RETURNING id, email, display_name, tier, email_verified, created_at, socials`,
        values
      );

      return json({ builder: rows[0] });
    }

    // Builder dashboard
    if (url.pathname === "/api/dashboard" && req.method === "GET") {
      const auth = req.headers.get("Authorization");
      if (!auth?.startsWith("Bearer ")) return json({ error: "auth_required", message: "Authorization header required" }, 401);
      const decoded = verifyBuilderToken(auth.slice(7));
      if (!decoded) return json({ error: "invalid_token", message: "Invalid or expired token" }, 401);
      const { rows: builderRows } = await pool.query(
        `SELECT id, email, display_name, tier, email_verified FROM builders WHERE id = $1`,
        [decoded.builder_id]
      );
      if (builderRows.length === 0) return json({ error: "builder not found" }, 404);
      const builder = builderRows[0];
      const maxSlots = TIER_LIMITS[builder.tier] ?? 3;

      const { rows: agentRows } = await pool.query(
        `SELECT
           a.id, a.name, a.role, a.status, a.avatar_seed,
           a.score_state_mu, a.score_state_sigma, a.last_evaluated_at,
           a.last_heartbeat as last_active_at,
           c.id as company_id, c.name as company_name,
           (SELECT COUNT(*)::int FROM messages m
            JOIN channels ch ON m.channel_id = ch.id
            WHERE m.author_id = a.id) as messages_sent
         FROM agents a
         LEFT JOIN companies c ON a.company_id = c.id
         WHERE a.builder_id = $1 AND a.status != 'retired'
         ORDER BY a.created_at`,
        [decoded.builder_id]
      );

      const agents = agentRows.map(a => ({
        id: a.id,
        name: a.name,
        role: a.role,
        status: a.status,
        avatar_seed: a.avatar_seed,
        company: a.company_id ? { id: a.company_id, name: a.company_name } : null,
        // Canonical HEAR composite — null if not yet evaluated.
        score_state_mu: a.score_state_mu === null ? null : Number(a.score_state_mu),
        score_state_sigma: a.score_state_sigma === null ? null : Number(a.score_state_sigma),
        last_evaluated_at: a.last_evaluated_at,
        messages_sent: a.messages_sent,
        last_active_at: a.last_active_at,
      }));

      return json({
        builder: { ...builder, email_verified: builder.email_verified ?? false },
        agents,
        slots_used: agents.length,
        slots_max: maxSlots === Infinity ? "unlimited" : maxSlots,
      });
    }

    // Builder dashboard — API hires (both directions) for the authenticated builder.
    // Depends on the P6.2 `agent_hires` migration; until that ships, the query hits
    // "relation does not exist" (42P01) and we return empty arrays so the UI renders.
    if (url.pathname === "/api/dashboard/hires" && req.method === "GET") {
      const auth = req.headers.get("Authorization");
      if (!auth?.startsWith("Bearer ")) return json({ error: "auth_required", message: "Authorization header required" }, 401);
      const decoded = verifyBuilderToken(auth.slice(7));
      if (!decoded) return json({ error: "invalid_token", message: "Invalid or expired token" }, 401);

      try {
        // Hires where the authenticated builder is the hirer (money out).
        // Cost is summed from agent_hire_calls (partitioned); wrapped in COALESCE so a hire
        // with zero calls reports $0 rather than NULL.
        const { rows: myHireRows } = await pool.query(
          `SELECT h.id, h.calls_count, h.created_at, h.expires_at, h.revoked_at,
                  (SELECT COALESCE(SUM(c.llm_cost_estimate), 0)
                     FROM agent_hire_calls c WHERE c.hire_id = h.id) AS cost_estimate_usd,
                  a.id AS agent_id, a.name AS agent_name, a.role AS agent_role, a.avatar_seed,
                  co.id AS company_id, co.name AS company_name,
                  b.id AS owner_id, b.display_name AS owner_name
             FROM agent_hires h
             JOIN agents a ON a.id = h.agent_id
             JOIN builders b ON b.id = a.builder_id
             LEFT JOIN companies co ON co.id = a.company_id
            WHERE h.hiring_builder_id = $1 AND h.revoked_at IS NULL
            ORDER BY h.created_at DESC
            LIMIT 100`,
          [decoded.builder_id]
        );

        // Hires where someone else is paying to call one of this builder's agents (money in).
        const { rows: theirHireRows } = await pool.query(
          `SELECT h.id, h.calls_count, h.created_at, h.expires_at, h.revoked_at,
                  (SELECT COALESCE(SUM(c.llm_cost_estimate), 0)
                     FROM agent_hire_calls c WHERE c.hire_id = h.id) AS cost_estimate_usd,
                  a.id AS agent_id, a.name AS agent_name, a.role AS agent_role, a.avatar_seed,
                  co.id AS company_id, co.name AS company_name,
                  b.id AS hirer_id, b.display_name AS hirer_name
             FROM agent_hires h
             JOIN agents a ON a.id = h.agent_id
             JOIN builders b ON b.id = h.hiring_builder_id
             LEFT JOIN companies co ON co.id = a.company_id
            WHERE a.builder_id = $1 AND h.revoked_at IS NULL
            ORDER BY h.created_at DESC
            LIMIT 100`,
          [decoded.builder_id]
        );

        const mapRow = (row: Record<string, unknown>, counterpartKey: "owner" | "hirer") => ({
          id: row.id as string,
          agent: {
            id: row.agent_id as string,
            name: row.agent_name as string,
            role: row.agent_role as string,
            avatar_seed: row.avatar_seed as string,
          },
          company: row.company_id
            ? { id: row.company_id as string, name: row.company_name as string }
            : null,
          counterpart: counterpartKey === "owner"
            ? { id: row.owner_id as string, display_name: row.owner_name as string }
            : { id: row.hirer_id as string, display_name: row.hirer_name as string },
          calls_count: row.calls_count === null ? 0 : Number(row.calls_count),
          cost_estimate_usd: row.cost_estimate_usd === null ? 0 : Number(row.cost_estimate_usd),
          created_at: row.created_at as string,
          expires_at: row.expires_at as string | null,
        });

        return json({
          my_hires: myHireRows.map((r) => mapRow(r, "owner")),
          their_hires: theirHireRows.map((r) => mapRow(r, "hirer")),
        });
      } catch (err) {
        // 42P01 = undefined_table. Expected until the P6.2 migration ships.
        if ((err as { code?: string }).code === "42P01") {
          return json({ my_hires: [], their_hires: [] });
        }
        throw err;
      }
    }

    if (url.pathname.startsWith("/api/dashboard/hires/") && req.method === "DELETE") {
      const auth = req.headers.get("Authorization");
      if (!auth?.startsWith("Bearer ")) return json({ error: "auth_required", message: "Authorization header required" }, 401);
      const decoded = verifyBuilderToken(auth.slice(7));
      if (!decoded) return json({ error: "invalid_token", message: "Invalid or expired token" }, 401);

      const hireId = url.pathname.slice("/api/dashboard/hires/".length);
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(hireId)) return json({ error: "invalid_id", message: "Hire id must be a UUID" }, 400);

      try {
        const { rowCount } = await pool.query(
          `UPDATE agent_hires
              SET revoked_at = now()
            WHERE id = $1 AND hiring_builder_id = $2 AND revoked_at IS NULL`,
          [hireId, decoded.builder_id]
        );
        if (rowCount === 0) return json({ error: "not_found", message: "Hire not found" }, 404);
        return json({ ok: true });
      } catch (err) {
        if ((err as { code?: string }).code === "42P01") {
          return json({ error: "not_found", message: "Hire not found" }, 404);
        }
        throw err;
      }
    }

    // Leaderboard — top 50 agents by canonical HEAR composite score
    // (agents.score_state_mu, maintained by peer-evaluation + judge write paths).
    // The ?dimension=quality alias is kept temporarily for backward compatibility
    // and falls through to the same HEAR ordering (see handler further down).
    if (url.pathname === "/api/leaderboard" && req.method === "GET" && url.searchParams.get("dimension") !== "quality") {
      const companyFilter = url.searchParams.get("company_id");
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (companyFilter && !uuidRegex.test(companyFilter)) return json({ agents: [] });

      const data = await marketplaceCache.wrap(cacheKeyFromUrl(url), async () => {

      const whereClause = companyFilter
        ? `WHERE a.status != 'retired' AND a.company_id = $1`
        : `WHERE a.status != 'retired'`;
      const params = companyFilter ? [companyFilter] : [];

      const { rows } = await pool.query(
        `SELECT
           a.id, a.name, a.role, a.avatar_seed,
           a.score_state_mu, a.score_state_sigma, a.last_evaluated_at,
           a.llm_provider,
           c.id as company_id, c.name as company_name
         FROM agents a
         LEFT JOIN companies c ON a.company_id = c.id
         ${whereClause}
         ORDER BY a.score_state_mu DESC NULLS LAST, a.created_at ASC
         LIMIT 50`,
        params
      );

      // Batch trend: each agent's HEAR composite 24h ago, derived from
      // quality_evaluations (the canonical log). Trend compares the latest
      // per-axis score_state_mu from >24h ago vs the current snapshot on
      // agents.score_state_mu.
      const agentIds = rows.map(r => r.id);
      const trendMap = new Map<string, number>();
      if (agentIds.length > 0) {
        const { rows: trends } = await pool.query(
          `WITH latest_old_per_axis AS (
             SELECT DISTINCT ON (agent_id, axis)
               agent_id, axis, score_state_mu
             FROM quality_evaluations
             WHERE agent_id = ANY($1)
               AND computed_at < now() - INTERVAL '24 hours'
               AND invalidated_at IS NULL
               AND score_state_mu IS NOT NULL
             ORDER BY agent_id, axis, computed_at DESC
           )
           SELECT agent_id, AVG(score_state_mu)::float as old_score
           FROM latest_old_per_axis
           GROUP BY agent_id`,
          [agentIds]
        );
        for (const t of trends) trendMap.set(t.agent_id, t.old_score);
      }

      // Batch activity stats: messages today, artifacts, reactions received
      const statsMap = new Map<string, { messages_today: number; artifacts_count: number; reactions_received: number }>();
      if (agentIds.length > 0) {
        const { rows: stats } = await pool.query(
          `SELECT
             a.id as agent_id,
             COALESCE(msg.cnt, 0)::int as messages_today,
             COALESCE(art.cnt, 0)::int as artifacts_count,
             COALESCE(rx.cnt, 0)::int as reactions_received
           FROM unnest($1::uuid[]) AS a(id)
           LEFT JOIN LATERAL (
             SELECT COUNT(*)::int as cnt FROM messages
             WHERE author_id = a.id AND created_at > now() - INTERVAL '24 hours'
           ) msg ON true
           LEFT JOIN LATERAL (
             SELECT COUNT(*)::int as cnt FROM artifacts WHERE author_id = a.id
           ) art ON true
           LEFT JOIN LATERAL (
             SELECT COUNT(*)::int as cnt FROM reactions r
             JOIN messages m ON r.message_id = m.id AND r.message_created_at = m.created_at
             WHERE m.author_id = a.id
           ) rx ON true`,
          [agentIds]
        );
        for (const s of stats) {
          statsMap.set(s.agent_id, {
            messages_today: s.messages_today,
            artifacts_count: s.artifacts_count,
            reactions_received: s.reactions_received,
          });
        }
      }

      const agents = rows.map((row, i) => {
        const currentScore = row.score_state_mu === null ? null : Number(row.score_state_mu);
        const oldScore = trendMap.get(row.id) ?? null;
        // Trend only meaningful when we have both current and past HEAR scores.
        let trend: "up" | "down" | "stable" = "stable";
        if (currentScore !== null && oldScore !== null) {
          const diff = currentScore - oldScore;
          trend = diff >= 0.3 ? "up" : diff <= -0.3 ? "down" : "stable";
        }
        const activity = statsMap.get(row.id) ?? { messages_today: 0, artifacts_count: 0, reactions_received: 0 };
        return {
          rank: i + 1,
          id: row.id,
          name: row.name,
          role: row.role,
          avatar_seed: row.avatar_seed,
          company: row.company_id ? { id: row.company_id, name: row.company_name } : null,
          // Canonical HEAR composite (agents.score_state_mu). Null = not evaluated yet.
          score_state_mu: currentScore,
          score_state_sigma: row.score_state_sigma === null ? null : Number(row.score_state_sigma),
          last_evaluated_at: row.last_evaluated_at,
          llm_provider: row.llm_provider ?? null,
          trend,
          messages_today: activity.messages_today,
          artifacts_count: activity.artifacts_count,
          reactions_received: activity.reactions_received,
        };
      });

        return { agents };
      }, TTL_LEADERBOARD_PERF_MS);
      return json(data);
    }

    // Agent profile
    if (url.pathname.match(/^\/api\/agents\/[^/]+$/) && req.method === "GET") {
      const agentId = url.pathname.split("/")[3];
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(agentId)) {
        return json({ error: "not_found", message: "Agent not found" }, 404);
      }

      const { rows } = await pool.query(
        `SELECT a.id, a.name, a.role, a.personality_brief, a.status, a.avatar_seed,
                a.score_state_mu, a.score_state_sigma, a.last_evaluated_at,
                a.llm_provider,
                a.created_at as deployed_at, a.last_heartbeat as last_active_at,
                c.id as company_id, c.name as company_name,
                b.display_name as builder_name, b.socials as builder_socials
         FROM agents a
         LEFT JOIN companies c ON a.company_id = c.id
         LEFT JOIN builders b ON a.builder_id = b.id
         WHERE a.id = $1`,
        [agentId]
      );

      if (rows.length === 0) return json({ error: "not_found", message: "Agent not found" }, 404);
      const agent = rows[0];

      // Stats (messages count scans all partitions — acceptable for V1, consider caching later)
      const { rows: [msgStats] } = await pool.query(
        `SELECT COUNT(*)::int as count FROM messages WHERE author_id = $1`,
        [agentId]
      );
      const { rows: [artStats] } = await pool.query(
        `SELECT COUNT(*)::int as count FROM artifacts WHERE author_id = $1`,
        [agentId]
      );
      const { rows: [kudosStats] } = await pool.query(
        `SELECT COUNT(*)::int as count FROM reactions r
         JOIN messages m ON r.message_id = m.id AND r.message_created_at = m.created_at
         WHERE m.author_id = $1 AND r.emoji IN ('👍','❤️','🔥','⭐','🎉')`,
        [agentId]
      );
      const uptimeDays = Math.floor(
        (Date.now() - new Date(agent.deployed_at).getTime()) / (1000 * 60 * 60 * 24)
      );

      // Fork lineage (#211) — present only when this agent was forked from another.
      // LIMIT 1 is belt-and-suspenders over the UNIQUE(parent, child) constraint.
      const { rows: forkRows } = await pool.query(
        `SELECT p.id   AS parent_agent_id,
                p.name AS parent_agent_name,
                pc.name AS parent_company_name
         FROM agent_forks af
         JOIN agents p  ON p.id = af.parent_agent_id
         LEFT JOIN companies pc ON pc.id = p.company_id
         WHERE af.child_agent_id = $1
         LIMIT 1`,
        [agentId]
      );
      const forkSource = forkRows.length > 0
        ? {
            parent_agent_id:     forkRows[0].parent_agent_id,
            parent_agent_name:   forkRows[0].parent_agent_name,
            parent_company_name: forkRows[0].parent_company_name ?? null,
          }
        : null;

      return json({ agent: {
        id: agent.id,
        name: agent.name,
        role: agent.role,
        personality_brief: agent.personality_brief,
        status: agent.status,
        avatar_seed: agent.avatar_seed,
        // Canonical HEAR composite (null = "Not evaluated yet").
        score_state_mu: agent.score_state_mu === null ? null : Number(agent.score_state_mu),
        score_state_sigma: agent.score_state_sigma === null ? null : Number(agent.score_state_sigma),
        last_evaluated_at: agent.last_evaluated_at,
        llm_provider: agent.llm_provider ?? null,
        company: agent.company_id ? { id: agent.company_id, name: agent.company_name } : null,
        builder: { display_name: agent.builder_name, socials: agent.builder_socials ?? null },
        stats: {
          messages_sent: msgStats.count,
          artifacts_created: artStats.count,
          kudos_received: kudosStats.count,
          uptime_days: uptimeDays,
        },
        deployed_at: agent.deployed_at,
        last_active_at: agent.last_active_at,
        fork_source: forkSource,
      } });
    }

    // Curated agent collections for the home page strips (issue #200).
    // Whitelisted slugs only — no string interpolation into SQL.
    if (url.pathname.match(/^\/api\/agents\/collections\/[^/]+$/) && req.method === "GET") {
      const slug = url.pathname.split("/")[4];

      const COLLECTION_LIMIT = 8;
      const NEW_PROMISING_WINDOW_DAYS = 14;
      const PROLIFIC_WINDOW_HOURS = 24;

      const baseSelect = `
        SELECT a.id, a.name, a.role, a.avatar_seed,
               a.score_state_mu, a.score_state_sigma, a.last_evaluated_at,
               a.llm_provider,
               c.id as company_id, c.name as company_name
        FROM agents a
        LEFT JOIN companies c ON a.company_id = c.id
      `;

      let sql: string;
      let params: (string | number)[] = [];
      let title: string;
      let filterQuery: string;

      if (slug === "top-developers") {
        title = "Top Developers";
        filterQuery = "role=developer";
        sql = `${baseSelect}
          WHERE a.status != 'retired' AND a.role = 'developer' AND a.score_state_mu IS NOT NULL
          ORDER BY a.score_state_mu DESC NULLS LAST, a.created_at ASC
          LIMIT $1`;
        params = [COLLECTION_LIMIT];
      } else if (slug === "most-reliable-qa") {
        title = "Most Reliable QA";
        filterQuery = "role=qa";
        sql = `${baseSelect}
          WHERE a.status != 'retired' AND a.role = 'qa' AND a.score_state_mu IS NOT NULL
          ORDER BY a.score_state_mu DESC NULLS LAST, a.created_at ASC
          LIMIT $1`;
        params = [COLLECTION_LIMIT];
      } else if (slug === "new-and-promising") {
        title = "New & Promising";
        filterQuery = "sort=newest";
        sql = `${baseSelect}
          WHERE a.status != 'retired'
            AND a.created_at > now() - ($2 || ' days')::interval
          ORDER BY a.score_state_mu DESC NULLS LAST, a.created_at DESC
          LIMIT $1`;
        params = [COLLECTION_LIMIT, NEW_PROMISING_WINDOW_DAYS];
      } else if (slug === "most-prolific") {
        title = "Most Prolific";
        filterQuery = "sort=messages";
        // Count messages in the recent window per agent, then join back to agents.
        sql = `
          WITH author_counts AS (
            SELECT author_id, COUNT(*)::int AS msg_count
            FROM messages
            WHERE created_at > now() - ($2 || ' hours')::interval
            GROUP BY author_id
          )
          SELECT a.id, a.name, a.role, a.avatar_seed,
                 a.score_state_mu, a.score_state_sigma, a.last_evaluated_at,
                 a.llm_provider,
                 c.id as company_id, c.name as company_name,
                 ac.msg_count
          FROM agents a
          JOIN author_counts ac ON ac.author_id = a.id
          LEFT JOIN companies c ON a.company_id = c.id
          WHERE a.status != 'retired' AND ac.msg_count > 0
          ORDER BY ac.msg_count DESC, a.score_state_mu DESC NULLS LAST
          LIMIT $1`;
        params = [COLLECTION_LIMIT, PROLIFIC_WINDOW_HOURS];
      } else {
        return json({ error: "unknown_collection", message: "Unknown collection slug" }, 404);
      }

      try {
        const data = await marketplaceCache.wrap(cacheKeyFromUrl(url), async () => {
          const { rows } = await pool.query(sql, params);
          const agents = rows.map((row) => ({
            id: row.id,
            name: row.name,
            role: row.role,
            avatar_seed: row.avatar_seed,
            score_state_mu: row.score_state_mu === null ? null : Number(row.score_state_mu),
            score_state_sigma: row.score_state_sigma === null ? null : Number(row.score_state_sigma),
            last_evaluated_at: row.last_evaluated_at,
            llm_provider: row.llm_provider ?? null,
            company: row.company_id ? { id: row.company_id, name: row.company_name } : null,
          }));
          return { slug, title, filter_query: filterQuery, agents };
        }, TTL_COLLECTIONS_MS);
        return json(data);
      } catch (err) {
        console.error(`[collections] /api/agents/collections/${slug} error:`, err);
        return json({ error: "internal_error" }, 500);
      }
    }

    // ===== HEAR — quality endpoints =====

    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    // V1: 7 axes. persona_coherence deferred to V2 (longitudinal grading required).
    const HEAR_AXES = [
      "reasoning_depth",
      "decision_wisdom",
      "communication_clarity",
      "initiative_quality",
      "collaborative_intelligence",
      "self_awareness_calibration",
      "contextual_judgment",
    ] as const;
    const MIN_AXES_FOR_COMPOSITE = 5; // out of 7 — avoid ranking partially-graded agents

    // Agent badges — achievement badges (public, cached 1h). Computed
    // on-demand from stats until #226 ships the persisted agent_badges table.
    if (url.pathname.match(/^\/api\/agents\/[^/]+\/badges$/) && req.method === "GET") {
      const agentId = url.pathname.split("/")[3];
      try {
        return await handleAgentBadges(agentId, pool);
      } catch (err) {
        console.error("[badges] /api/agents/:id/badges error:", err);
        return json({ error: "internal_error" }, 500);
      }
    }

    // Agent quality — canonical HEAR composite (from agents snapshot) +
    // latest per-axis score_state_mu for the drilldown UI.
    if (url.pathname.match(/^\/api\/agents\/[^/]+\/quality$/) && req.method === "GET") {
      const agentId = url.pathname.split("/")[3];
      if (!UUID_RE.test(agentId)) return json({ error: "agent not found" }, 404);
      try {
        const { rows: snapshotRows } = await pool.query<{
          score_state_mu: string | null;
          score_state_sigma: string | null;
          last_evaluated_at: string | null;
        }>(
          `SELECT score_state_mu, score_state_sigma, last_evaluated_at
           FROM agents WHERE id = $1`,
          [agentId]
        );
        if (snapshotRows.length === 0) return json({ error: "agent not found" }, 404);
        const snap = snapshotRows[0];

        const { rows } = await pool.query(
          `SELECT DISTINCT ON (axis) axis, score, score_state_mu, score_state_sigma, computed_at
           FROM quality_evaluations
           WHERE agent_id = $1 AND invalidated_at IS NULL
           ORDER BY axis, computed_at DESC`,
          [agentId]
        );
        const axes: Record<string, { score: number; sigma: number | null; last_updated: string } | null> = {};
        for (const a of HEAR_AXES) axes[a] = null;
        let gradedAxes = 0;
        for (const row of rows) {
          if (!HEAR_AXES.includes(row.axis)) continue;
          // Per-axis score uses score_state_mu (the bayesian state) — same
          // unit as the composite on agents.score_state_mu, so breakdown
          // and top-level score are on the same scale.
          axes[row.axis] = {
            score: row.score_state_mu === null ? Number(row.score) : Number(row.score_state_mu),
            sigma: row.score_state_sigma === null ? null : Number(row.score_state_sigma),
            last_updated: row.computed_at,
          };
          gradedAxes += 1;
        }

        // Composite = canonical HEAR score from agents snapshot.
        // Null = "Not evaluated yet" (empty state copy in the UI).
        const composite = snap.score_state_mu === null ? null : Number(snap.score_state_mu);
        return json({
          axes,
          composite,
          score_state_mu: composite,
          score_state_sigma: snap.score_state_sigma === null ? null : Number(snap.score_state_sigma),
          last_evaluated_at: snap.last_evaluated_at,
          graded_axes: gradedAxes,
        });
      } catch (err) {
        console.error("[hear] /api/agents/:id/quality error:", err);
        return json({ error: "internal_error" }, 500);
      }
    }

    // Agent quality explanations — latest judgments with reasoning
    if (url.pathname.match(/^\/api\/agents\/[^/]+\/quality\/explanations$/) && req.method === "GET") {
      const agentId = url.pathname.split("/")[3];
      if (!UUID_RE.test(agentId)) return json({ error: "agent not found" }, 404);
      const axisParam = url.searchParams.get("axis");
      if (axisParam && !HEAR_AXES.includes(axisParam as typeof HEAR_AXES[number])) {
        return json({ error: "invalid axis" }, 400);
      }
      const rawLimit = parseInt(url.searchParams.get("limit") || "10", 10);
      const limit = Math.min(Math.max(isNaN(rawLimit) ? 10 : rawLimit, 1), 50);
      try {
        const params: unknown[] = [agentId];
        let where = `agent_id = $1 AND invalidated_at IS NULL`;
        if (axisParam) {
          params.push(axisParam);
          where += ` AND axis = $2`;
        }
        params.push(limit);
        const { rows } = await pool.query(
          `SELECT axis, score, reasoning, evidence_quotes, computed_at
           FROM quality_evaluations
           WHERE ${where}
           ORDER BY computed_at DESC
           LIMIT $${params.length}`,
          params
        );
        const explanations = rows.map(r => ({
          axis: r.axis,
          score: Number(r.score),
          reasoning: r.reasoning,
          evidence_quotes: r.evidence_quotes,
          computed_at: r.computed_at,
        }));
        return json({ explanations });
      } catch (err) {
        console.error("[hear] /api/agents/:id/quality/explanations error:", err);
        return json({ error: "internal_error" }, 500);
      }
    }

    // Agent quality timeline — daily score for last N days.
    // When ?axis is provided: daily AVG on that single axis (clean).
    // When ?axis is omitted: daily composite but ONLY for days where all
    //   HEAR_AXES are present (otherwise AVG mixes axes and produces meaningless
    //   noise when the sampler rotates through axes on different days).
    if (url.pathname.match(/^\/api\/agents\/[^/]+\/quality\/timeline$/) && req.method === "GET") {
      const agentId = url.pathname.split("/")[3];
      if (!UUID_RE.test(agentId)) return json({ error: "agent not found" }, 404);
      const axisParam = url.searchParams.get("axis");
      if (axisParam && !HEAR_AXES.includes(axisParam as typeof HEAR_AXES[number])) {
        return json({ error: "invalid axis" }, 400);
      }
      const rawDays = parseInt(url.searchParams.get("days") || "30", 10);
      const days = Math.min(Math.max(isNaN(rawDays) ? 30 : rawDays, 1), 90);
      try {
        let rows;
        if (axisParam) {
          // Per-axis timeline: use score_state_mu (the bayesian state) so
          // the Y-axis matches the composite shown on the profile.
          const result = await pool.query(
            `SELECT DATE(computed_at) as date,
                    AVG(score_state_mu)::float as score,
                    AVG(score_state_sigma)::float as sigma
             FROM quality_evaluations
             WHERE agent_id = $1 AND axis = $2
               AND computed_at > now() - ($3 || ' days')::interval
               AND invalidated_at IS NULL
               AND score_state_mu IS NOT NULL
             GROUP BY DATE(computed_at)
             ORDER BY date`,
            [agentId, axisParam, days]
          );
          rows = result.rows;
        } else {
          // Composite timeline: AVG across axes of score_state_mu per day.
          // Only emit a point when at least MIN_AXES_FOR_COMPOSITE axes have
          // data that day, so early sparse coverage doesn't look noisy.
          const result = await pool.query(
            `SELECT date, score, sigma FROM (
               SELECT DATE(computed_at) as date,
                      AVG(score_state_mu)::float as score,
                      AVG(score_state_sigma)::float as sigma,
                      COUNT(DISTINCT axis)::int as distinct_axes
               FROM quality_evaluations
               WHERE agent_id = $1
                 AND computed_at > now() - ($2 || ' days')::interval
                 AND axis = ANY($3)
                 AND invalidated_at IS NULL
                 AND score_state_mu IS NOT NULL
               GROUP BY DATE(computed_at)
             ) sub
             WHERE distinct_axes >= $4
             ORDER BY date`,
            [agentId, days, HEAR_AXES, MIN_AXES_FOR_COMPOSITE]
          );
          rows = result.rows;
        }
        const timeline = rows.map(r => ({
          date: r.date,
          score: r.score === null ? null : Number(r.score),
          sigma: r.sigma === null ? null : Number(r.sigma),
        }));
        return json({ timeline });
      } catch (err) {
        console.error("[hear] /api/agents/:id/quality/timeline error:", err);
        return json({ error: "internal_error" }, 500);
      }
    }

    // Single artifact detail — privacy-checked (#188).
    // Content is returned only to (a) the author agent's builder, (b) an
    // active agent in the same company, or (c) any requester when the agent
    // has `is_artifact_content_public = true`. Otherwise metadata only.
    if (url.pathname.match(/^\/api\/artifacts\/[^/]+$/) && req.method === "GET") {
      const artifactId = url.pathname.split("/")[3];
      try {
        const requester = await resolveRequester(req.headers.get("Authorization"));
        return await handleArtifactGet(artifactId, pool, requester);
      } catch (err) {
        console.error("[hear] /api/artifacts/:id error:", err);
        return json({ error: "internal_error" }, 500);
      }
    }

    // Artifact judgment — latest HEAR evaluation per axis for an artifact
    if (url.pathname.match(/^\/api\/artifacts\/[^/]+\/judgment$/) && req.method === "GET") {
      const artifactId = url.pathname.split("/")[3];
      if (!UUID_RE.test(artifactId)) return json({ error: "not_found", message: "Judgment not found" }, 404);
      try {
        const { rows } = await pool.query(
          `SELECT DISTINCT ON (axis)
             axis, score, score_state_sigma, judge_disagreement,
             was_escalated, methodology_version, reasoning, evidence_quotes,
             computed_at
           FROM quality_evaluations
           WHERE artifact_id = $1 AND invalidated_at IS NULL
           ORDER BY axis, computed_at DESC`,
          [artifactId]
        );
        if (rows.length === 0) return json({ error: "not_found", message: "Judgment not found" }, 404);
        const axes: Record<string, unknown> = {};
        let maxDisagreement = 0;
        let wasEscalated = false;
        let methodologyVersion: string | null = null;
        for (const row of rows) {
          axes[row.axis] = {
            score: Number(row.score),
            sigma: row.score_state_sigma === null ? null : Number(row.score_state_sigma),
            reasoning: row.reasoning,
            evidence_quotes: row.evidence_quotes,
            computed_at: row.computed_at,
          };
          const d = row.judge_disagreement === null ? 0 : Number(row.judge_disagreement);
          if (d > maxDisagreement) maxDisagreement = d;
          if (row.was_escalated) wasEscalated = true;
          methodologyVersion = row.methodology_version;
        }
        return json({ judgment: {
          axes,
          judge_disagreement: maxDisagreement,
          was_escalated: wasEscalated,
          methodology_version: methodologyVersion,
        } });
      } catch (err) {
        console.error("[hear] /api/artifacts/:id/judgment error:", err);
        return json({ error: "internal_error" }, 500);
      }
    }

    // Leaderboard (quality dimension) — reuses existing /api/leaderboard path when dimension=quality
    if (url.pathname === "/api/leaderboard" && req.method === "GET" && url.searchParams.get("dimension") === "quality") {
      const axisParam = url.searchParams.get("axis");
      const roleParam = url.searchParams.get("role");
      if (axisParam && !HEAR_AXES.includes(axisParam as typeof HEAR_AXES[number])) {
        return json({ error: "invalid axis" }, 400);
      }
      if (roleParam && !VALID_ROLES.includes(roleParam as typeof VALID_ROLES[number])) {
        return json({ error: "invalid role" }, 400);
      }
      try {
        const data = await marketplaceCache.wrap(cacheKeyFromUrl(url), async () => {
        const params: unknown[] = [];
        const whereParts = [`a.status != 'retired'`];
        if (roleParam) {
          params.push(roleParam);
          whereParts.push(`a.role = $${params.length}`);
        }
        let axisClause = "";
        if (axisParam) {
          params.push(axisParam);
          axisClause = `AND qe.axis = $${params.length}`;
        }
        // When no axis filter, require MIN_AXES_FOR_COMPOSITE graded axes
        // so an agent with one lucky 9 doesn't outrank an agent with seven 7s.
        // When an axis filter is set, one axis is sufficient (we're ranking on that axis alone).
        const minAxes = axisParam ? 1 : MIN_AXES_FOR_COMPOSITE;
        const { rows } = await pool.query(
          `WITH latest AS (
             SELECT DISTINCT ON (qe.agent_id, qe.axis)
               qe.agent_id, qe.axis, qe.score, qe.score_state_sigma
             FROM quality_evaluations qe
             WHERE qe.invalidated_at IS NULL ${axisClause}
             ORDER BY qe.agent_id, qe.axis, qe.computed_at DESC
           ),
           composite AS (
             SELECT agent_id,
                    AVG(score)::float as score,
                    AVG(score_state_sigma)::float as sigma,
                    COUNT(*)::int as graded_axes
             FROM latest
             GROUP BY agent_id
             HAVING COUNT(*) >= ${minAxes}
           )
           SELECT
             a.id, a.name, a.role, a.avatar_seed,
             c.id as company_id, c.name as company_name,
             comp.score, comp.sigma
           FROM agents a
           LEFT JOIN companies c ON a.company_id = c.id
           JOIN composite comp ON comp.agent_id = a.id
           WHERE ${whereParts.join(" AND ")}
           ORDER BY comp.score DESC NULLS LAST
           LIMIT 50`,
          params
        );
        const agents = rows.map((row, i) => ({
          rank: i + 1,
          id: row.id,
          name: row.name,
          role: row.role,
          avatar_seed: row.avatar_seed,
          company: row.company_id ? { id: row.company_id, name: row.company_name } : null,
          score_state_mu: row.score === null ? null : Number(row.score),
          sigma: row.sigma === null ? null : Number(row.sigma),
          trend: "stable" as const,
        }));
          return { agents, dimension: "quality" as const };
        }, TTL_LEADERBOARD_QUALITY_MS);
        return json(data);
      } catch (err) {
        console.error("[hear] /api/leaderboard?dimension=quality error:", err);
        return json({ error: "internal_error" }, 500);
      }
    }

    // Research: methodology — static JSON (no DB)
    if (url.pathname === "/api/research/methodology" && req.method === "GET") {
      return json({
        rubric_version: "1.0",
        methodology_version: "1.0",
        // V1: 7 axes. persona_coherence deferred to V2 (longitudinal grading).
        axes: [
          { id: "reasoning_depth", label: "Reasoning Depth" },
          { id: "decision_wisdom", label: "Decision Wisdom" },
          { id: "communication_clarity", label: "Communication Clarity" },
          { id: "initiative_quality", label: "Initiative Quality" },
          { id: "collaborative_intelligence", label: "Collaborative Intelligence" },
          { id: "self_awareness_calibration", label: "Self-Awareness & Calibration" },
          { id: "contextual_judgment", label: "Contextual Judgment" },
        ],
        theoretical_frameworks: [
          { name: "Dual Process Theory", citation: "Kahneman (2011). Thinking, Fast and Slow." },
          { name: "Grice's Cooperative Principle", citation: "Grice (1975). Logic and Conversation." },
          { name: "Bloom's Taxonomy", citation: "Anderson & Krathwohl (2001). A Taxonomy for Learning." },
          { name: "Self-Determination Theory", citation: "Deci & Ryan (1985). Intrinsic Motivation." },
          { name: "Metacognition / Calibration", citation: "Flavell (1979). Metacognition and Cognitive Monitoring." },
          { name: "Contextual Integrity", citation: "Nissenbaum (2004). Privacy as Contextual Integrity." },
        ],
      });
    }

    // Research: calibration stats — psychometric reliability summary
    if (url.pathname === "/api/research/calibration-stats" && req.method === "GET") {
      try {
        const resultsPath = join(import.meta.dir, "../../docs/research/calibration/analysis/e4-results.json");
        const file = Bun.file(resultsPath);
        if (await file.exists()) {
          const data = await file.json();
          return json({
            cohen_kappa: null,
            krippendorff_alpha: null,
            icc: null,
            test_retest_correlation: null,
            calibration_drift: null,
            last_computed: data.computed_at ?? null,
            factor_analysis: data.factor_analysis ?? null,
            discriminant_validity: data.discriminant_validity ?? null,
            irt: data.irt ?? null,
            fairness: data.fairness ?? null,
          });
        }
      } catch {
        // fall through to null response
      }
      return json({
        cohen_kappa: null,
        krippendorff_alpha: null,
        icc: null,
        test_retest_correlation: null,
        calibration_drift: null,
        last_computed: null,
        factor_analysis: null,
        discriminant_validity: null,
        irt: null,
        fairness: null,
      });
    }

    // Research: cost — current month's judge_runs spend
    if (url.pathname === "/api/research/cost" && req.method === "GET") {
      try {
        const { rows } = await pool.query(
          `SELECT
             COALESCE(SUM(cost_usd), 0)::float as current_month_usd,
             COALESCE(AVG(cost_usd), 0)::float as cost_per_eval_avg,
             COUNT(*)::int as run_count
           FROM judge_runs
           WHERE created_at >= date_trunc('month', now())
             AND invalidated_at IS NULL`
        );
        const r = rows[0] || { current_month_usd: 0, cost_per_eval_avg: 0, run_count: 0 };
        return json({
          current_month_usd: Number(r.current_month_usd) || 0,
          monthly_cap_usd: 50,
          cost_per_eval_avg: Number(r.cost_per_eval_avg) || 0,
          trend: "stable",
        });
      } catch (err) {
        console.error("[hear] /api/research/cost error:", err);
        return json({ error: "internal_error" }, 500);
      }
    }

    // Research: calibration set browser (paginated)
    if (url.pathname === "/api/research/calibration-set" && req.method === "GET") {
      const rawLimit = parseInt(url.searchParams.get("limit") || "10", 10);
      const limit = Math.min(Math.max(isNaN(rawLimit) ? 10 : rawLimit, 1), 50);
      const rawOffset = parseInt(url.searchParams.get("offset") || "0", 10);
      const offset = Math.max(isNaN(rawOffset) ? 0 : rawOffset, 0);
      try {
        const { rows: items } = await pool.query(
          `SELECT id, artifact_type, artifact_content, rubric_version, added_at
           FROM calibration_set
           ORDER BY added_at DESC
           LIMIT $1 OFFSET $2`,
          [limit, offset]
        );
        if (items.length === 0) return json({ items: [] });
        const ids = items.map(i => i.id);
        const { rows: grades } = await pool.query(
          `SELECT calibration_id, grader_id, axis, score, justification, graded_at
           FROM calibration_grades
           WHERE calibration_id = ANY($1)`,
          [ids]
        );
        const gradesByCalib = new Map<string, unknown[]>();
        for (const g of grades) {
          if (!gradesByCalib.has(g.calibration_id)) gradesByCalib.set(g.calibration_id, []);
          gradesByCalib.get(g.calibration_id)!.push({
            grader_id: g.grader_id,
            axis: g.axis,
            score: g.score,
            justification: g.justification,
            graded_at: g.graded_at,
          });
        }
        const payload = items.map(i => ({
          id: i.id,
          artifact_type: i.artifact_type,
          anonymized_content: i.artifact_content,
          rubric_version: i.rubric_version,
          added_at: i.added_at,
          grades: gradesByCalib.get(i.id) || [],
        }));
        return json({ items: payload, limit, offset });
      } catch (err) {
        console.error("[hear] /api/research/calibration-set error:", err);
        return json({ error: "internal_error" }, 500);
      }
    }

    // Internal: quality notify — broadcasts WS events, does NOT write to DB.
    // Authenticated by shared secret header. The Judge service has already
    // persisted results via its own DB connection before calling this.
    if (url.pathname === "/api/internal/quality/notify" && req.method === "POST") {
      const expected = process.env.HIVE_INTERNAL_TOKEN;
      if (!expected) {
        console.error("[hear] HIVE_INTERNAL_TOKEN not configured");
        return json({ error: "internal_not_configured" }, 500);
      }
      const provided = req.headers.get("X-Hive-Internal-Token");
      if (!provided) return json({ error: "unauthorized", message: "Unauthorized" }, 401);
      // Constant-time comparison to prevent timing attacks on the shared secret.
      const a = Buffer.from(provided);
      const b = Buffer.from(expected);
      if (a.length !== b.length || !timingSafeEqual(a, b)) {
        return json({ error: "unauthorized", message: "Unauthorized" }, 401);
      }
      const body = await req.json().catch(() => null) as {
        batch_id?: string;
        evaluations?: Array<{
          agent_id?: string;
          axis?: string;
          new_score?: number;
          sigma?: number;
          delta?: number;
        }>;
      } | null;
      if (!body?.batch_id || !Array.isArray(body.evaluations)) {
        return json({ error: "batch_id and evaluations[] required" }, 400);
      }
      try {
        let broadcast = 0;
        for (const ev of body.evaluations) {
          if (!ev.agent_id || !UUID_RE.test(ev.agent_id)) continue;
          if (!ev.axis || !HEAR_AXES.includes(ev.axis as typeof HEAR_AXES[number])) continue;
          const { rows } = await pool.query(
            `SELECT company_id FROM agents WHERE id = $1`,
            [ev.agent_id]
          );
          const companyId = rows[0]?.company_id;
          if (!companyId) continue;
          router.broadcast(companyId, {
            type: "quality_updated",
            agent_id: ev.agent_id,
            axis: ev.axis,
            new_score: Number(ev.new_score ?? 0),
            sigma: Number(ev.sigma ?? 0),
            delta: Number(ev.delta ?? 0),
          });
          broadcast += 1;
        }

        // Composite-level refresh: for each unique agent touched, recompute
        // the snapshot and broadcast one agent_score_refreshed event so
        // every spectator UI can patch the composite score without refetch.
        const uniqueAgentIds = Array.from(
          new Set(
            body.evaluations
              .map((ev) => ev.agent_id)
              .filter((id): id is string => !!id && UUID_RE.test(id)),
          ),
        );
        for (const agentId of uniqueAgentIds) {
          const snapshot = await recomputeAgentScoreState(agentId);
          if (!snapshot) continue;
          router.broadcast(snapshot.company_id, {
            type: "agent_score_refreshed",
            agent_id: snapshot.agent_id,
            company_id: snapshot.company_id,
            score_state_mu: snapshot.score_state_mu,
            score_state_sigma: snapshot.score_state_sigma,
            last_evaluated_at: snapshot.last_evaluated_at,
          });
        }

        return json({ ok: true, batch_id: body.batch_id, broadcast });
      } catch (err) {
        console.error("[hear] /api/internal/quality/notify error:", err);
        return json({ error: "internal_error" }, 500);
      }
    }

    // Internal: invalidate all scores from a batch (disaster recovery).
    // Soft-deletes quality_evaluations + judge_runs for the given batch_id.
    // Authenticated by shared secret header.
    if (
      url.pathname === "/api/internal/quality/invalidate-batch" &&
      req.method === "POST"
    ) {
      const expected = process.env.HIVE_INTERNAL_TOKEN;
      if (!expected) {
        console.error("[hear] HIVE_INTERNAL_TOKEN not configured");
        return json({ error: "internal_not_configured" }, 500);
      }
      const provided = req.headers.get("X-Hive-Internal-Token");
      if (!provided || provided.length !== expected.length || !timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) {
        return json({ error: "unauthorized", message: "Unauthorized" }, 401);
      }
      const body = await req.json().catch(() => null) as {
        batch_id?: string;
        reason?: string;
      } | null;
      if (!body?.batch_id || !UUID_RE.test(body.batch_id)) {
        return json({ error: "batch_id (UUID) required" }, 400);
      }
      if (!body.reason || body.reason.trim().length === 0) {
        return json({ error: "reason required" }, 400);
      }
      if (body.reason.trim().length > 500) {
        return json({ error: "reason must be 500 characters or fewer" }, 400);
      }
      const reason = body.reason.trim();
      const batchId = body.batch_id;
      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        // Two queries so we get an accurate run count (rowCount on UPDATE)
        // and the distinct artifact IDs without conflating the two numbers.
        const { rowCount: runsInvalidated } = await client.query(
          `UPDATE judge_runs
           SET invalidated_at = now(), invalidation_reason = $1
           WHERE batch_id = $2 AND invalidated_at IS NULL`,
          [reason, batchId],
        );
        const { rows: invalidatedRows } = await client.query<{
          artifact_id: string;
        }>(
          `SELECT DISTINCT artifact_id FROM judge_runs
           WHERE batch_id = $1 AND artifact_id IS NOT NULL`,
          [batchId],
        );
        const artifactIds = invalidatedRows.map((r) => r.artifact_id);

        let evalsInvalidated = 0;
        let rescoredSnapshots: AgentScoreSnapshot[] = [];
        if (artifactIds.length > 0) {
          const { rowCount } = await client.query(
            `UPDATE quality_evaluations
             SET invalidated_at = now(), invalidation_reason = $1
             WHERE artifact_id = ANY($2) AND invalidated_at IS NULL`,
            [reason, artifactIds],
          );
          evalsInvalidated = rowCount ?? 0;

          // Refresh the canonical HEAR snapshot for every agent whose
          // evaluations were just invalidated — keeps agents.score_state_mu
          // consistent with the now-reduced set of active evaluations.
          rescoredSnapshots = await recomputeAgentScoreStateForArtifacts(
            artifactIds,
            client,
          );
        }
        const agentsRescored = rescoredSnapshots.length;

        await client.query("COMMIT");

        // Broadcast composite refresh for every agent whose snapshot changed.
        for (const snapshot of rescoredSnapshots) {
          router.broadcast(snapshot.company_id, {
            type: "agent_score_refreshed",
            agent_id: snapshot.agent_id,
            company_id: snapshot.company_id,
            score_state_mu: snapshot.score_state_mu,
            score_state_sigma: snapshot.score_state_sigma,
            last_evaluated_at: snapshot.last_evaluated_at,
          });
        }

        console.log(
          `[hear] invalidated batch ${batchId}: ${runsInvalidated} runs, ${evalsInvalidated} evals, ${agentsRescored} agents rescored — ${reason}`,
        );
        return json({
          ok: true,
          runs_invalidated: runsInvalidated ?? 0,
          evaluations_invalidated: evalsInvalidated,
          agents_rescored: agentsRescored,
        });
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        console.error("[hear] /api/internal/quality/invalidate-batch error:", err);
        return json({ error: "internal_error" }, 500);
      } finally {
        client.release();
      }
    }

    // Recent feed — last 20 messages across all companies (public: message content is intentionally visible to all)
    if (url.pathname === "/api/feed/recent" && req.method === "GET") {
      try {
        const rawLimit = parseInt(url.searchParams.get("limit") ?? "20", 10);
        const limit = Math.min(Math.max(isNaN(rawLimit) ? 20 : rawLimit, 1), 50);
        // Cache key uses the normalized limit so `?limit=abc` and `?limit=20` share an entry.
        const cacheKey = `/api/feed/recent?limit=${limit}`;
        const data = await marketplaceCache.wrap(cacheKey, async () => {
          const { rows } = await pool.query(
            `SELECT
               m.id,
               LEFT(m.content, 120) as content,
               m.created_at,
               ag.name as agent_name,
               ag.avatar_seed,
               c.id as company_id,
               c.name as company_name,
               ch.name as channel_name
             FROM messages m
             JOIN channels ch ON m.channel_id = ch.id
             JOIN companies c ON ch.company_id = c.id
             JOIN agents ag ON m.author_id = ag.id
             ORDER BY m.created_at DESC
             LIMIT $1`,
            [limit]
          );
          return { events: rows };
        }, TTL_FEED_RECENT_MS);
        return json(data);
      } catch (err) {
        console.error("[feed] /api/feed/recent error:", err);
        return json({ error: "internal_error" }, 500);
      }
    }

    // Root: API info page
    if (url.pathname === "/") {
      return json({
        name: "Hive",
        version: "0.1.0",
        description: "Persistent, observable digital world where AI agents live and work together 24/7.",
        endpoints: {
          health: "/health",
          api: "/api",
          websocket_agent: "/agent",
          websocket_spectator: "/watch",
        },
      });
    }

    return new Response("Not Found", { status: 404 });
  },

  websocket: {
    async open() {},

    async message(ws, message) {
      try {
        const data = ws.data as unknown as AgentSocket["data"] | SpectatorSocket["data"];
        if (!data) return;
        const raw = typeof message === "string" ? message : message.toString();
        if (data.type === "agent") await handleAgentMessage(ws as unknown as AgentSocket, raw);
        else if (data.type === "spectator") await handleSpectatorMessage(ws as unknown as SpectatorSocket, raw);
      } catch (err) {
        console.error("WebSocket message handler error:", err);
      }
    },

    async close(ws) {
      const data = ws.data as unknown as AgentSocket["data"] | SpectatorSocket["data"];
      if (!data) return;
      if (data.type === "agent" && (data as AgentSocket["data"]).authenticated) {
        const a = ws as unknown as AgentSocket;
        router.removeAgent(a);
        // Conditional UPDATE: don't overwrite 'retired' status
        const { rowCount } = await pool.query(
          `UPDATE agents SET status = 'disconnected' WHERE id = $1 AND status != 'retired'`,
          [a.data.agentId]
        );
        // Only broadcast agent_left if the row was actually updated (not a retire-triggered close)
        if (rowCount && rowCount > 0 && a.data.companyId) {
          router.broadcast(a.data.companyId, { type: "agent_left", agent_id: a.data.agentId, reason: "disconnected" });
          broadcastStatsUpdate(a.data.companyId);
          checkLifecycle(a.data.companyId).catch(err => console.error("[lifecycle] check error:", err));
        }
        console.log(`[ws] Agent disconnected: ${a.data.agentName}`);
      } else if (data.type === "spectator") {
        const s = ws as unknown as SpectatorSocket;
        router.removeSpectator(s);
        const prev = spectatorIpCounts.get(s.data.ip) ?? 1;
        if (prev <= 1) spectatorIpCounts.delete(s.data.ip);
        else spectatorIpCounts.set(s.data.ip, prev - 1);
      }
    },
  },
});

/** Handle an incoming WebSocket message from an agent connection. */
async function handleAgentMessage(ws: AgentSocket, raw: string) {
  const event = parseAgentEvent(raw);
  if (!event) { ws.send(JSON.stringify({ type: "error", message: "invalid JSON" })); return; }
  const err = validateEvent(event);
  if (err) { ws.send(JSON.stringify({ type: "error", message: err })); return; }

  if (event.type === "auth") {
    if (ws.data.authenticated) { ws.send(JSON.stringify({ type: "error", message: "already authenticated" })); return; }
    const agent = await authenticateAgent(event.api_key);
    if (!agent) { ws.send(JSON.stringify({ type: "auth_error", reason: "invalid API key" } satisfies AuthErrorEvent)); ws.close(); return; }

    ws.data.agentId = agent.agent_id;
    ws.data.agentName = agent.name;
    ws.data.companyId = agent.company_id;
    ws.data.authenticated = true;
    let channels: { id: string; name: string; type: string }[] = [];
    let teammates: { id: string; name: string; role: string; status: string }[] = [];
    let company: { id: string; name: string } | null = null;

    const newStatus = agent.company_id ? "assigned" : "connected";
    await pool.query(`UPDATE agents SET status = $1, last_heartbeat = now() WHERE id = $2`, [newStatus, agent.agent_id]);

    if (agent.company_id) {
      router.addAgent(agent.company_id, ws);
      channels = (await pool.query(`SELECT id, name, type FROM channels WHERE company_id = $1 OR company_id IS NULL ORDER BY company_id IS NULL ASC, name ASC`, [agent.company_id])).rows;
      teammates = (await pool.query(`SELECT id, name, role, status, avatar_seed FROM agents WHERE company_id = $1 AND id != $2 AND status NOT IN ('retired','disconnected')`, [agent.company_id, agent.agent_id])).rows;
      company = (await pool.query(`SELECT id, name FROM companies WHERE id = $1`, [agent.company_id])).rows[0] || null;
      router.broadcast(agent.company_id, { type: "agent_joined", agent_id: agent.agent_id, name: agent.name, role: agent.role, avatar_seed: agent.avatar_seed, company_id: agent.company_id }, agent.agent_id);
      broadcastStatsUpdate(agent.company_id);
    }

    ws.send(JSON.stringify({ type: "auth_ok", agent_id: agent.agent_id, agent_name: agent.name, company, channels, teammates } satisfies AuthOkEvent));
    console.log(`[ws] Agent connected: ${agent.name} (${agent.role})${company ? ` -> ${company.name}` : " (unassigned)"}`);
    if (agent.company_id) checkLifecycle(agent.company_id).catch(err => console.error("[lifecycle] check error:", err));
    return;
  }

  await handleAgentEvent(ws, event);
}

/** Handle an incoming WebSocket message from a spectator connection. */
async function handleSpectatorMessage(ws: SpectatorSocket, raw: string) {
  try {
    const data = JSON.parse(raw);
    if (data.type === "watch_company" && typeof data.company_id === "string" && isValidUUID(data.company_id)) {
      if (ws.data.watchingCompanyId) router.removeSpectator(ws);
      ws.data.watchingCompanyId = data.company_id;
      router.addSpectator(data.company_id, ws);

      // Single presence_snapshot event: roster + recent messages.
      // Replaces the previous loop of N agent_joined + M message_posted
      // events that caused phantom "X joined" feed entries on every
      // company re-entry. See issue #169.
      const { rows: agents } = await pool.query(
        `SELECT id, name, role, status, avatar_seed
         FROM agents
         WHERE company_id = $1 AND status != 'retired'`,
        [data.company_id]
      );
      // Last 50 messages within the last hour — enough context, short
      // enough to stay snappy.
      const { rows: messages } = await pool.query(
        `SELECT m.id, m.content, m.thread_id, m.created_at,
                a.name as author, a.id as author_id,
                ch.name as channel, ch.id as channel_id
         FROM messages m
         JOIN agents a ON m.author_id = a.id
         JOIN channels ch ON m.channel_id = ch.id
         WHERE ch.company_id = $1
           AND m.created_at > now() - INTERVAL '1 hour'
         ORDER BY m.created_at DESC
         LIMIT 50`,
        [data.company_id]
      );
      const snapshot: import("./protocol/types").PresenceSnapshotEvent = {
        type: "presence_snapshot",
        company_id: data.company_id,
        agents: agents.map(a => ({
          agent_id: a.id,
          name: a.name,
          role: a.role,
          status: a.status,
          avatar_seed: a.avatar_seed,
        })),
        messages: messages.reverse().map(m => ({
          message_id: m.id,
          author: m.author,
          author_id: m.author_id,
          content: m.content,
          channel: m.channel,
          channel_id: m.channel_id,
          thread_id: m.thread_id,
          timestamp: new Date(m.created_at).getTime(),
        })),
      };
      ws.send(JSON.stringify(snapshot));
    }

    if (data.type === "watch_all") {
      if (ws.data.watchingAll) return;
      ws.data.watchingAll = true;

      // Send initial stats snapshot for all companies (single batch query)
      const { rows: companies } = await pool.query<{
        id: string;
        agent_count: string;
        active_agent_count: string;
        messages_today: string;
      }>(`
        SELECT
          c.id,
          COUNT(CASE WHEN a.status NOT IN ('retired','disconnected') THEN 1 END)::text AS agent_count,
          COUNT(CASE WHEN a.status = 'active' THEN 1 END)::text AS active_agent_count,
          (SELECT COUNT(*) FROM messages m
            WHERE m.author_id IN (SELECT id FROM agents WHERE company_id = c.id)
            AND m.created_at >= CURRENT_DATE AT TIME ZONE 'UTC')::text AS messages_today
        FROM companies c
        LEFT JOIN agents a ON a.company_id = c.id
        GROUP BY c.id
      `);
      for (const company of companies) {
        ws.send(JSON.stringify({
          type: "company_stats_updated",
          company_id: company.id,
          agent_count: parseInt(company.agent_count, 10),
          active_agent_count: parseInt(company.active_agent_count, 10),
          messages_today: parseInt(company.messages_today, 10),
        }));
      }
      router.addAllWatcher(ws); // register only after snapshot is successfully sent
    }
  } catch (err) { console.error("[ws] spectator message error:", err); }
}

// Company lifecycle checker (every 5 minutes)
setInterval(() => {
  checkAllLifecycles().catch(err => console.error("[lifecycle] periodic check error:", err));
}, 5 * 60_000);

// Badge attribution (daily) — awards the six cosmetic badges defined in issue #226.
// Composite PK on agent_badges makes each INSERT idempotent, so mis-fires are safe.
const ONE_DAY_MS = 24 * 60 * 60_000;
function runAwardBadges() {
  awardBadges(pool)
    .then(({ awarded, byType }) => {
      if (awarded > 0) console.log(`[badges] awarded ${awarded} new badges`, byType);
    })
    .catch(err => console.error("[badges] award error:", err));
}
setTimeout(runAwardBadges, 60_000); // first run 1 minute after boot (lets migrations settle)
setInterval(runAwardBadges, ONE_DAY_MS);

// Heartbeat checker + peer eval cleanup
setInterval(async () => {
  const now = new Date();
  await pool.query(`UPDATE agents SET status = 'idle' WHERE status = 'active' AND last_heartbeat < $1`, [new Date(now.getTime() - 5 * 60 * 1000)]);
  await pool.query(`UPDATE agents SET status = 'sleeping' WHERE status IN ('active','idle') AND last_heartbeat < $1`, [new Date(now.getTime() - 30 * 60 * 1000)]);

  // Expire stale peer evaluations (survives server restarts, unlike setTimeout)
  const { rowCount } = await pool.query(
    `UPDATE peer_evaluations SET status = 'timeout'
     WHERE status = 'pending' AND requested_at < now() - INTERVAL '5 minutes'`
  );
  if (rowCount && rowCount > 0) {
    console.log(`[peer-eval] Expired ${rowCount} pending evaluations`);
  }

  // Prune stale spectator IP counts (IPs with 0 connections that were never cleaned up)
  for (const [ip, count] of spectatorIpCounts) {
    if (count <= 0) spectatorIpCounts.delete(ip);
  }
}, 60_000);

console.log(`
  ╔═══════════════════════════════════════╗
  ║         HIVE — Server v0.1         ║
  ║  ws://localhost:${PORT}/agent              ║
  ║  ws://localhost:${PORT}/watch              ║
  ║  http://localhost:${PORT}                  ║
  ║  The world is running.                ║
  ╚═══════════════════════════════════════╝
`);

import pool from "./db/pool";
import { authenticateAgent, hashPassword, verifyPassword, createBuilderToken, verifyBuilderToken, generateApiKey, hashApiKey, apiKeyPrefix } from "./auth/index";
import { parseAgentEvent, validateEvent } from "./protocol/validate";
import { handleAgentEvent, broadcastStatsUpdate } from "./engine/handlers";
import { router, type AgentSocket, type SpectatorSocket } from "./router/index";
import { checkLifecycle, checkAllLifecycles } from "./engine/company-lifecycle";
import { assignCompany } from "./engine/placement";
import { runObserver, runDailyRollup } from "./engine/observer";
import type { AuthOkEvent, AuthErrorEvent } from "./protocol/types";

/** Server port, configurable via PORT env var. */
const PORT = Number(process.env.PORT) || 3000;

/** Per-IP connection cap for /watch to limit fan-out abuse. */
const MAX_SPECTATORS_PER_IP = 5;
const spectatorIpCounts = new Map<string, number>();

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

/** Build a JSON response with CORS headers. */
function json(data: unknown, status = 200): Response {
  const res = Response.json(data, { status });
  for (const [k, v] of Object.entries(CORS)) res.headers.set(k, v);
  return res;
}

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
      const body = await req.json().catch(() => null);
      if (!body?.email || !body?.password || !body?.display_name) return json({ error: "email, password, display_name required" }, 400);
      try {
        const { rows } = await pool.query(
          `INSERT INTO builders (email, password_hash, display_name) VALUES ($1, $2, $3) RETURNING id, email, display_name`,
          [body.email, await hashPassword(body.password), body.display_name]
        );
        return json({ builder: rows[0], token: createBuilderToken(rows[0].id) }, 201);
      } catch (err: unknown) {
        if (err instanceof Error && err.message.includes("unique")) return json({ error: "email_taken" }, 409);
        throw err;
      }
    }

    if (url.pathname === "/api/builders/login" && req.method === "POST") {
      const body = await req.json().catch(() => null);
      if (!body?.email || !body?.password) return json({ error: "email and password required" }, 400);
      const { rows } = await pool.query(`SELECT id, email, display_name, password_hash FROM builders WHERE email = $1`, [body.email]);
      if (rows.length === 0 || !(await verifyPassword(body.password, rows[0].password_hash))) return json({ error: "invalid_credentials", message: "Invalid email or password" }, 401);
      return json({ builder: { id: rows[0].id, email: rows[0].email, display_name: rows[0].display_name }, token: createBuilderToken(rows[0].id) });
    }

    if (url.pathname === "/api/agents/register" && req.method === "POST") {
      const auth = req.headers.get("Authorization");
      if (!auth?.startsWith("Bearer ")) return json({ error: "auth required" }, 401);
      const decoded = verifyBuilderToken(auth.slice(7));
      if (!decoded) return json({ error: "invalid token" }, 401);
      const body = await req.json().catch(() => null);
      if (!body?.name || !body?.role) return json({ error: "name and role required" }, 400);
      const validRoles = ["pm", "designer", "developer", "qa", "ops", "generalist"];
      if (!validRoles.includes(body.role)) return json({ error: `role must be: ${validRoles.join(", ")}` }, 400);
      const { rows: builderRows } = await pool.query(`SELECT tier FROM builders WHERE id = $1`, [decoded.builder_id]);
      const tier = builderRows[0]?.tier || "free";
      const tierLimits: Record<string, number> = { free: 3, verified: 10, trusted: Infinity };
      const maxSlots = tierLimits[tier] ?? 3;
      const { rows: counts } = await pool.query(`SELECT COUNT(*)::int as c FROM agents WHERE builder_id = $1 AND status != 'retired'`, [decoded.builder_id]);
      if (counts[0].c >= maxSlots) return json({ error: "slots_full", message: `${tier} tier limit reached (${maxSlots} agents)`, tier, max_slots: maxSlots }, 403);
      const apiKey = generateApiKey();
      try {
        const { rows } = await pool.query(
          `INSERT INTO agents (builder_id, name, role, personality_brief, api_key_hash, api_key_prefix) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, name, role`,
          [decoded.builder_id, body.name, body.role, body.personality_brief || null, await hashApiKey(apiKey), apiKeyPrefix(apiKey)]
        );
        const agent = rows[0];
        const company = await assignCompany(agent.id, decoded.builder_id, body.role);
        await checkLifecycle(company.companyId);
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
      if (!auth?.startsWith("Bearer ")) return json({ error: "auth required" }, 401);
      const decoded = verifyBuilderToken(auth.slice(7));
      if (!decoded) return json({ error: "invalid token" }, 401);

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
           COALESCE(ROUND(AVG(a.reputation_score)), 0)::int as avg_reputation,
           (SELECT COUNT(*)::int FROM messages m
            JOIN channels ch ON m.channel_id = ch.id
            WHERE ch.company_id = c.id AND m.created_at > now() - INTERVAL '24 hours') as messages_today,
           c.last_activity_at,
           c.floor_plan,
           c.founded_at
         FROM companies c
         LEFT JOIN agents a ON a.company_id = c.id AND a.status NOT IN ('retired', 'disconnected')
         WHERE 1=1 ${statusFilter}
         GROUP BY c.id
         ORDER BY ${orderBy}`,
        params
      );
      return json({ companies: rows });
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
      if (rows.length === 0) return json({ error: "company not found" }, 404);
      return json(rows[0]);
    }

    // Generate office map for a company
    if (url.pathname.startsWith("/api/companies/") && url.pathname.endsWith("/map") && req.method === "GET") {
      const companyId = url.pathname.split("/")[3];
      const { rows: agents } = await pool.query(
        `SELECT COUNT(*)::int as c FROM agents WHERE company_id = $1 AND status NOT IN ('retired','disconnected')`,
        [companyId]
      );
      const agentCount = Math.max(agents[0]?.c || 0, 3); // minimum 3 for a reasonable office
      const { generateOffice } = await import("./engine/office-generator");
      return json(generateOffice(agentCount));
    }

    // Builder profile
    if (url.pathname === "/api/builders/me" && req.method === "GET") {
      const auth = req.headers.get("Authorization");
      if (!auth?.startsWith("Bearer ")) return json({ error: "auth required" }, 401);
      const decoded = verifyBuilderToken(auth.slice(7));
      if (!decoded) return json({ error: "invalid token" }, 401);
      const { rows } = await pool.query(
        `SELECT id, email, display_name, tier, email_verified, created_at, socials FROM builders WHERE id = $1`,
        [decoded.builder_id]
      );
      if (rows.length === 0) return json({ error: "builder not found" }, 404);
      return json(rows[0]);
    }

    // Update builder profile
    if (url.pathname === "/api/builders/me" && req.method === "PATCH") {
      const token = req.headers.get("authorization")?.replace("Bearer ", "");
      if (!token) return json({ error: "unauthorized" }, 401);

      const payload = verifyBuilderToken(token);
      if (!payload) return json({ error: "unauthorized" }, 401);

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
        if (typeof body.socials !== "object" || body.socials === null) {
          return json({ error: "validation_error", message: "socials must be an object" }, 400);
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
      if (!auth?.startsWith("Bearer ")) return json({ error: "auth required" }, 401);
      const decoded = verifyBuilderToken(auth.slice(7));
      if (!decoded) return json({ error: "invalid token" }, 401);
      const { rows: builderRows } = await pool.query(
        `SELECT id, email, display_name, tier, email_verified FROM builders WHERE id = $1`,
        [decoded.builder_id]
      );
      if (builderRows.length === 0) return json({ error: "builder not found" }, 404);
      const builder = builderRows[0];
      const tierLimits: Record<string, number> = { free: 3, verified: 10, trusted: Infinity };
      const maxSlots = tierLimits[builder.tier] ?? 3;

      const { rows: agentRows } = await pool.query(
        `SELECT
           a.id, a.name, a.role, a.status, a.reputation_score, a.last_heartbeat as last_active_at,
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
        company: a.company_id ? { id: a.company_id, name: a.company_name } : null,
        reputation_score: Number(a.reputation_score),
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

    // Leaderboard — top 50 agents by reputation (performance dimension).
    // When dimension=quality, fall through to the HEAR quality leaderboard
    // handler further down in this file.
    if (url.pathname === "/api/leaderboard" && req.method === "GET" && url.searchParams.get("dimension") !== "quality") {
      const companyFilter = url.searchParams.get("company_id");
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (companyFilter && !uuidRegex.test(companyFilter)) return json({ agents: [] });

      const whereClause = companyFilter
        ? `WHERE a.status != 'retired' AND a.company_id = $1`
        : `WHERE a.status != 'retired'`;
      const params = companyFilter ? [companyFilter] : [];

      const { rows } = await pool.query(
        `SELECT
           a.id, a.name, a.role, a.avatar_seed, a.reputation_score,
           c.id as company_id, c.name as company_name
         FROM agents a
         LEFT JOIN companies c ON a.company_id = c.id
         ${whereClause}
         ORDER BY a.reputation_score DESC
         LIMIT 50`,
        params
      );

      // Batch trend: single query for all 50 agents' old scores (24h ago)
      const agentIds = rows.map(r => r.id);
      const trendMap = new Map<string, number>();
      if (agentIds.length > 0) {
        const { rows: trends } = await pool.query(
          `WITH latest_old AS (
             SELECT DISTINCT ON (rh.agent_id, rh.axis)
               rh.agent_id, rh.score
             FROM reputation_history rh
             WHERE rh.agent_id = ANY($1)
               AND rh.computed_at < now() - INTERVAL '24 hours'
             ORDER BY rh.agent_id, rh.axis, rh.computed_at DESC
           )
           SELECT agent_id, AVG(score)::float as old_score
           FROM latest_old
           GROUP BY agent_id`,
          [agentIds]
        );
        for (const t of trends) trendMap.set(t.agent_id, t.old_score);
      }

      const agents = rows.map((row, i) => {
        const oldScore = trendMap.get(row.id) ?? Number(row.reputation_score);
        const diff = Number(row.reputation_score) - oldScore;
        const trend = diff >= 2 ? "up" : diff <= -2 ? "down" : "stable";
        return {
          rank: i + 1,
          id: row.id,
          name: row.name,
          role: row.role,
          avatar_seed: row.avatar_seed,
          company: row.company_id ? { id: row.company_id, name: row.company_name } : null,
          reputation_score: Number(row.reputation_score),
          trend,
        };
      });

      return json({ agents });
    }

    // Agent profile
    if (url.pathname.match(/^\/api\/agents\/[^/]+$/) && req.method === "GET") {
      const agentId = url.pathname.split("/")[3];
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(agentId)) {
        return json({ error: "agent not found" }, 404);
      }

      const { rows } = await pool.query(
        `SELECT a.id, a.name, a.role, a.personality_brief, a.status, a.avatar_seed,
                a.reputation_score, a.created_at as deployed_at, a.last_heartbeat as last_active_at,
                c.id as company_id, c.name as company_name,
                b.display_name as builder_name
         FROM agents a
         LEFT JOIN companies c ON a.company_id = c.id
         LEFT JOIN builders b ON a.builder_id = b.id
         WHERE a.id = $1`,
        [agentId]
      );

      if (rows.length === 0) return json({ error: "agent not found" }, 404);
      const agent = rows[0];

      // Reputation axes: latest score per axis (bounded to 90 days for partition pruning)
      const { rows: axes } = await pool.query(
        `SELECT DISTINCT ON (axis) axis, ROUND(score)::int as score
         FROM reputation_history
         WHERE agent_id = $1 AND computed_at > now() - INTERVAL '90 days'
         ORDER BY axis, computed_at DESC`,
        [agentId]
      );
      const reputationAxes: Record<string, number> = {};
      for (const row of axes) {
        reputationAxes[row.axis] = row.score;
      }

      // Reputation history 30 days: daily composite score
      const { rows: history30d } = await pool.query(
        `SELECT DATE(computed_at) as date,
                ROUND(AVG(score))::int as score
         FROM reputation_history
         WHERE agent_id = $1 AND computed_at > now() - INTERVAL '30 days'
         GROUP BY DATE(computed_at)
         ORDER BY date`,
        [agentId]
      );

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

      return json({
        id: agent.id,
        name: agent.name,
        role: agent.role,
        personality_brief: agent.personality_brief,
        status: agent.status,
        avatar_seed: agent.avatar_seed,
        reputation_score: Number(agent.reputation_score),
        company: agent.company_id ? { id: agent.company_id, name: agent.company_name } : null,
        builder: { display_name: agent.builder_name },
        reputation_axes: reputationAxes,
        reputation_history_30d: history30d,
        stats: {
          messages_sent: msgStats.count,
          artifacts_created: artStats.count,
          kudos_received: kudosStats.count,
          uptime_days: uptimeDays,
        },
        deployed_at: agent.deployed_at,
        last_active_at: agent.last_active_at,
      });
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

    // Agent quality — latest score per axis + composite
    if (url.pathname.match(/^\/api\/agents\/[^/]+\/quality$/) && req.method === "GET") {
      const agentId = url.pathname.split("/")[3];
      if (!UUID_RE.test(agentId)) return json({ error: "agent not found" }, 404);
      try {
        const { rows } = await pool.query(
          `SELECT DISTINCT ON (axis) axis, score, score_state_sigma, computed_at
           FROM quality_evaluations
           WHERE agent_id = $1
           ORDER BY axis, computed_at DESC`,
          [agentId]
        );
        const axes: Record<string, { score: number; sigma: number | null; last_updated: string } | null> = {};
        for (const a of HEAR_AXES) axes[a] = null;
        let sum = 0;
        let count = 0;
        for (const row of rows) {
          // Skip V2-deferred axes (persona_coherence) from composite
          if (!HEAR_AXES.includes(row.axis)) continue;
          axes[row.axis] = {
            score: Number(row.score),
            sigma: row.score_state_sigma === null ? null : Number(row.score_state_sigma),
            last_updated: row.computed_at,
          };
          sum += Number(row.score);
          count += 1;
        }
        // Require at least MIN_AXES_FOR_COMPOSITE graded axes for a stable composite
        const composite = count >= MIN_AXES_FOR_COMPOSITE ? sum / count : null;
        return json({ axes, composite, graded_axes: count });
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
        let where = `agent_id = $1`;
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

    // Agent quality timeline — daily score (per axis, or composite) for last N days
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
        const params: unknown[] = [agentId];
        let filter = `agent_id = $1 AND computed_at > now() - ($2 || ' days')::interval`;
        params.push(days);
        if (axisParam) {
          params.push(axisParam);
          filter += ` AND axis = $3`;
        }
        const { rows } = await pool.query(
          `SELECT DATE(computed_at) as date,
                  AVG(score)::float as score,
                  AVG(score_state_sigma)::float as sigma
           FROM quality_evaluations
           WHERE ${filter}
           GROUP BY DATE(computed_at)
           ORDER BY date`,
          params
        );
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

    // Single artifact detail
    if (url.pathname.match(/^\/api\/artifacts\/[^/]+$/) && req.method === "GET") {
      const artifactId = url.pathname.split("/")[3];
      if (!UUID_RE.test(artifactId)) return json({ error: "artifact not found" }, 404);
      try {
        const { rows } = await pool.query(
          `SELECT ar.id, ar.type, ar.title, ar.content, ar.status,
                  ar.created_at, ar.updated_at,
                  ar.author_id, a.name as author_name,
                  ar.company_id, c.name as company_name
           FROM artifacts ar
           LEFT JOIN agents a ON ar.author_id = a.id
           LEFT JOIN companies c ON ar.company_id = c.id
           WHERE ar.id = $1`,
          [artifactId]
        );
        if (rows.length === 0) return json({ error: "artifact not found" }, 404);
        const a = rows[0];
        return json({
          id: a.id,
          type: a.type,
          title: a.title,
          content: a.content,
          author_id: a.author_id,
          author_name: a.author_name,
          company_id: a.company_id,
          company_name: a.company_name,
          status: a.status,
          created_at: a.created_at,
          updated_at: a.updated_at,
        });
      } catch (err) {
        console.error("[hear] /api/artifacts/:id error:", err);
        return json({ error: "internal_error" }, 500);
      }
    }

    // Artifact judgment — latest HEAR evaluation per axis for an artifact
    if (url.pathname.match(/^\/api\/artifacts\/[^/]+\/judgment$/) && req.method === "GET") {
      const artifactId = url.pathname.split("/")[3];
      if (!UUID_RE.test(artifactId)) return json({ error: "judgment not found" }, 404);
      try {
        const { rows } = await pool.query(
          `SELECT DISTINCT ON (axis)
             axis, score, score_state_sigma, judge_disagreement,
             was_escalated, methodology_version, reasoning, evidence_quotes,
             computed_at
           FROM quality_evaluations
           WHERE artifact_id = $1
           ORDER BY axis, computed_at DESC`,
          [artifactId]
        );
        if (rows.length === 0) return json({ error: "judgment not found" }, 404);
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
        return json({
          axes,
          judge_disagreement: maxDisagreement,
          was_escalated: wasEscalated,
          methodology_version: methodologyVersion,
        });
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
      const validRoles = ["pm", "designer", "developer", "qa", "ops", "generalist"];
      if (roleParam && !validRoles.includes(roleParam)) {
        return json({ error: "invalid role" }, 400);
      }
      try {
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
        const { rows } = await pool.query(
          `WITH latest AS (
             SELECT DISTINCT ON (qe.agent_id, qe.axis)
               qe.agent_id, qe.axis, qe.score, qe.score_state_sigma
             FROM quality_evaluations qe
             WHERE 1=1 ${axisClause}
             ORDER BY qe.agent_id, qe.axis, qe.computed_at DESC
           ),
           composite AS (
             SELECT agent_id,
                    AVG(score)::float as score,
                    AVG(score_state_sigma)::float as sigma
             FROM latest
             GROUP BY agent_id
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
          score: row.score === null ? null : Number(row.score),
          sigma: row.sigma === null ? null : Number(row.sigma),
          trend: "stable" as const,
        }));
        return json({ agents, dimension: "quality" });
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
        axes: [
          { id: "reasoning_depth", label: "Reasoning Depth" },
          { id: "decision_wisdom", label: "Decision Wisdom" },
          { id: "communication_clarity", label: "Communication Clarity" },
          { id: "initiative_quality", label: "Initiative Quality" },
          { id: "collaborative_intelligence", label: "Collaborative Intelligence" },
          { id: "self_awareness_calibration", label: "Self-Awareness & Calibration" },
          { id: "persona_coherence", label: "Persona Coherence" },
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
      // V2 will populate this from the HEAR analysis pipeline (E4). For V1 we
      // return nulls so the frontend can render "pending" without erroring.
      return json({
        cohen_kappa: null,
        krippendorff_alpha: null,
        icc: null,
        test_retest_correlation: null,
        calibration_drift: null,
        last_computed: null,
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
           WHERE created_at >= date_trunc('month', now())`
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
      if (!provided || provided !== expected) {
        return json({ error: "unauthorized" }, 401);
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
        return json({ ok: true, batch_id: body.batch_id, broadcast });
      } catch (err) {
        console.error("[hear] /api/internal/quality/notify error:", err);
        return json({ error: "internal_error" }, 500);
      }
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
      channels = (await pool.query(`SELECT id, name, type FROM channels WHERE company_id = $1 OR company_id IS NULL`, [agent.company_id])).rows;
      teammates = (await pool.query(`SELECT id, name, role, status FROM agents WHERE company_id = $1 AND id != $2 AND status NOT IN ('retired','disconnected')`, [agent.company_id, agent.agent_id])).rows;
      company = (await pool.query(`SELECT id, name FROM companies WHERE id = $1`, [agent.company_id])).rows[0] || null;
      router.broadcast(agent.company_id, { type: "agent_joined", agent_id: agent.agent_id, name: agent.name, role: agent.role, company_id: agent.company_id }, agent.agent_id);
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
    if (data.type === "watch_company" && typeof data.company_id === "string") {
      if (ws.data.watchingCompanyId) router.removeSpectator(ws);
      ws.data.watchingCompanyId = data.company_id;
      router.addSpectator(data.company_id, ws);

      // Send current state: which agents are in this company
      const { rows: agents } = await pool.query(
        `SELECT id, name, role, status FROM agents WHERE company_id = $1 AND status NOT IN ('retired', 'disconnected')`,
        [data.company_id]
      );
      for (const agent of agents) {
        ws.send(JSON.stringify({
          type: "agent_joined",
          agent_id: agent.id,
          name: agent.name,
          role: agent.role,
          company_id: data.company_id,
        }));
      }

      // Send recent messages (last 20)
      const { rows: messages } = await pool.query(
        `SELECT m.id, m.content, m.thread_id, m.created_at, a.name as author, a.id as author_id, ch.name as channel, ch.id as channel_id
         FROM messages m JOIN agents a ON m.author_id = a.id JOIN channels ch ON m.channel_id = ch.id
         WHERE ch.company_id = $1 ORDER BY m.created_at DESC LIMIT 20`,
        [data.company_id]
      );
      for (const msg of messages.reverse()) {
        ws.send(JSON.stringify({
          type: "message_posted",
          message_id: msg.id,
          author: msg.author,
          author_id: msg.author_id,
          content: msg.content,
          channel: msg.channel,
          channel_id: msg.channel_id,
          thread_id: msg.thread_id,
          timestamp: new Date(msg.created_at).getTime(),
        }));
      }
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

// Heartbeat checker
setInterval(async () => {
  const now = new Date();
  await pool.query(`UPDATE agents SET status = 'idle' WHERE status = 'active' AND last_heartbeat < $1`, [new Date(now.getTime() - 5 * 60 * 1000)]);
  await pool.query(`UPDATE agents SET status = 'sleeping' WHERE status IN ('active','idle') AND last_heartbeat < $1`, [new Date(now.getTime() - 30 * 60 * 1000)]);
}, 60_000);

// Observer: hourly reputation scoring
setInterval(() => {
  runObserver().catch(err => console.error("[observer] hourly scoring error:", err));
}, 60 * 60_000);

// Daily rollup: composite score + decay (schedule to next midnight UTC)
const msUntilMidnight = (() => {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setUTCHours(24, 0, 0, 0);
  return midnight.getTime() - now.getTime();
})();
setTimeout(() => {
  runDailyRollup().catch(err => console.error("[observer] daily rollup error:", err));
  // Then every 24 hours
  setInterval(() => {
    runDailyRollup().catch(err => console.error("[observer] daily rollup error:", err));
  }, 24 * 60 * 60_000);
}, msUntilMidnight);

console.log(`
  ╔═══════════════════════════════════════╗
  ║         HIVE — Server v0.1         ║
  ║  ws://localhost:${PORT}/agent              ║
  ║  ws://localhost:${PORT}/watch              ║
  ║  http://localhost:${PORT}                  ║
  ║  The world is running.                ║
  ╚═══════════════════════════════════════╝
`);

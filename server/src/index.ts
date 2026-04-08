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
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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
        if (err instanceof Error && err.message.includes("unique")) return json({ error: "email taken" }, 409);
        throw err;
      }
    }

    if (url.pathname === "/api/builders/login" && req.method === "POST") {
      const body = await req.json().catch(() => null);
      if (!body?.email || !body?.password) return json({ error: "email and password required" }, 400);
      const { rows } = await pool.query(`SELECT id, email, display_name, password_hash FROM builders WHERE email = $1`, [body.email]);
      if (rows.length === 0 || !(await verifyPassword(body.password, rows[0].password_hash))) return json({ error: "invalid credentials" }, 401);
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
        `SELECT id, email, display_name, tier, email_verified, created_at FROM builders WHERE id = $1`,
        [decoded.builder_id]
      );
      if (rows.length === 0) return json({ error: "builder not found" }, 404);
      return json(rows[0]);
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

    // Leaderboard — top 50 agents by reputation
    if (url.pathname === "/api/leaderboard" && req.method === "GET") {
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
        await pool.query(`UPDATE agents SET status = 'disconnected' WHERE id = $1`, [a.data.agentId]);
        if (a.data.companyId) {
          router.broadcast(a.data.companyId, { type: "agent_left", agent_id: a.data.agentId, reason: "disconnected" });
          broadcastStatsUpdate(a.data.companyId).catch((err) =>
            console.error("[ws] stats broadcast error:", err)
          );
          checkLifecycle(a.data.companyId);
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
      broadcastStatsUpdate(agent.company_id).catch((err) =>
        console.error("[ws] stats broadcast error:", err)
      );
    }

    ws.send(JSON.stringify({ type: "auth_ok", agent_id: agent.agent_id, agent_name: agent.name, company, channels, teammates } satisfies AuthOkEvent));
    console.log(`[ws] Agent connected: ${agent.name} (${agent.role})${company ? ` -> ${company.name}` : " (unassigned)"}`);
    if (agent.company_id) checkLifecycle(agent.company_id);
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

      // Send initial stats snapshot for all companies
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
            AND m.created_at >= CURRENT_DATE)::text AS messages_today
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
  } catch { /* ignore */ }
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

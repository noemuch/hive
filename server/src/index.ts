import pool from "./db/pool";
import { authenticateAgent, hashPassword, verifyPassword, createBuilderToken, verifyBuilderToken, generateApiKey, hashApiKey, apiKeyPrefix } from "./auth/index";
import { parseAgentEvent, validateEvent } from "./protocol/validate";
import { handleAgentEvent } from "./engine/handlers";
import { router, type AgentSocket, type SpectatorSocket } from "./router/index";
import type { AuthOkEvent, AuthErrorEvent } from "./protocol/types";

/** Server port, configurable via PORT env var. */
const PORT = Number(process.env.PORT) || 3000;

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
      return server.upgrade(req, {
        data: { type: "spectator" as const, watchingCompanyId: null as string | null },
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
      const { rows: counts } = await pool.query(`SELECT COUNT(*)::int as c FROM agents WHERE builder_id = $1 AND status != 'retired'`, [decoded.builder_id]);
      if (counts[0].c >= 10) return json({ error: "free tier: 10 agents max" }, 403);
      const apiKey = generateApiKey();
      const { rows: companies } = await pool.query(
        `SELECT c.id, c.name FROM companies c LEFT JOIN agents a ON a.company_id = c.id AND a.status NOT IN ('retired','disconnected')
         WHERE c.status = 'active' GROUP BY c.id HAVING COUNT(a.id) < 8 ORDER BY COUNT(a.id), random() LIMIT 1`
      );
      const companyId = companies[0]?.id || null;
      try {
        const { rows } = await pool.query(
          `INSERT INTO agents (builder_id, name, role, personality_brief, api_key_hash, api_key_prefix, company_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, name, role, company_id`,
          [decoded.builder_id, body.name, body.role, body.personality_brief || null, await hashApiKey(apiKey), apiKeyPrefix(apiKey), companyId]
        );
        return json({ agent: rows[0], api_key: apiKey, company: companies[0] || null, warning: "Save api_key now — cannot retrieve later." }, 201);
      } catch (err: unknown) {
        if (err instanceof Error && err.message.includes("unique")) return json({ error: "name taken" }, 409);
        throw err;
      }
    }

    if (url.pathname === "/api/companies" && req.method === "GET") {
      const { rows } = await pool.query(
        `SELECT c.id, c.name, c.description, c.status, c.founded_at, COUNT(a.id)::int as agent_count
         FROM companies c LEFT JOIN agents a ON a.company_id = c.id AND a.status NOT IN ('retired','disconnected')
         WHERE c.status != 'dissolved' GROUP BY c.id ORDER BY c.founded_at`
      );
      return json(rows);
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
        if (a.data.companyId) router.broadcast(a.data.companyId, { type: "agent_left", agent_id: a.data.agentId, reason: "disconnected" });
        console.log(`[ws] Agent disconnected: ${a.data.agentName}`);
      } else if (data.type === "spectator") {
        router.removeSpectator(ws as unknown as SpectatorSocket);
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
      channels = (await pool.query(`SELECT id, name, type FROM channels WHERE company_id = $1`, [agent.company_id])).rows;
      teammates = (await pool.query(`SELECT id, name, role, status FROM agents WHERE company_id = $1 AND id != $2 AND status NOT IN ('retired','disconnected')`, [agent.company_id, agent.agent_id])).rows;
      company = (await pool.query(`SELECT id, name FROM companies WHERE id = $1`, [agent.company_id])).rows[0] || null;
      router.broadcast(agent.company_id, { type: "agent_joined", agent_id: agent.agent_id, name: agent.name, role: agent.role, company_id: agent.company_id }, agent.agent_id);
    }

    ws.send(JSON.stringify({ type: "auth_ok", agent_id: agent.agent_id, agent_name: agent.name, company, channels, teammates } satisfies AuthOkEvent));
    console.log(`[ws] Agent connected: ${agent.name} (${agent.role})${company ? ` -> ${company.name}` : " (unassigned)"}`);
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
  } catch { /* ignore */ }
}

// Heartbeat checker
setInterval(async () => {
  const now = new Date();
  await pool.query(`UPDATE agents SET status = 'idle' WHERE status = 'active' AND last_heartbeat < $1`, [new Date(now.getTime() - 5 * 60 * 1000)]);
  await pool.query(`UPDATE agents SET status = 'sleeping' WHERE status IN ('active','idle') AND last_heartbeat < $1`, [new Date(now.getTime() - 30 * 60 * 1000)]);
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

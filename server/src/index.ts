import pool from "./db/pool";
import { authenticateAgent } from "./auth/index";
import { parseAgentEvent, validateEvent } from "./protocol/validate";
import { handleAgentEvent, broadcastStatsUpdate } from "./engine/handlers";
import { router, type AgentSocket, type SpectatorSocket } from "./router/index";
import { isValidUUID } from "./router/rate-limit";
import { checkLifecycle, checkAllLifecycles } from "./engine/company-lifecycle";
import { awardBadges } from "./jobs/award-badges";
import { dispatchRoute } from "./router/routes";
import type { RouteContext } from "./router/route-types";
import type { AuthOkEvent, AuthErrorEvent } from "./protocol/types";
import { CORS } from "./http/response";

/** Server port, configurable via PORT env var. */
const PORT = Number(process.env.PORT) || 3000;

if (!process.env.HIVE_INTERNAL_TOKEN) {
  console.warn("[!] HIVE_INTERNAL_TOKEN not set — internal quality endpoints will return 500");
}
if (!process.env.ALLOWED_ORIGIN) {
  console.warn("[!] ALLOWED_ORIGIN not set — CORS allows all origins (fine for dev, not for prod)");
}

/** Per-IP connection cap for /watch to limit fan-out abuse. */
const MAX_SPECTATORS_PER_IP = 5;
const spectatorIpCounts = new Map<string, number>();

function requestIp(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    server.requestIP(req)?.address ??
    "unknown"
  );
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
        data: {
          type: "agent" as const,
          agentId: "",
          agentName: "",
          companyId: null as string | null,
          authenticated: false,
        },
      })
        ? undefined
        : new Response("Upgrade failed", { status: 400 });
    }

    // WebSocket: spectator
    if (url.pathname === "/watch") {
      const ip = requestIp(req);
      const current = spectatorIpCounts.get(ip) ?? 0;
      if (current >= MAX_SPECTATORS_PER_IP) {
        return new Response("Too many connections", { status: 429 });
      }
      spectatorIpCounts.set(ip, current + 1);
      return server.upgrade(req, {
        data: {
          type: "spectator" as const,
          watchingCompanyId: null as string | null,
          watchingAll: false as boolean,
          ip,
        },
      })
        ? undefined
        : new Response("Upgrade failed", { status: 400 });
    }

    // REST — declarative dispatch through the route table.
    const ctx: RouteContext = {
      req,
      url,
      pool,
      server,
      ip: requestIp(req),
      params: {},
    };
    const routed = await dispatchRoute(ctx);
    if (routed) return routed;

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
        else if (data.type === "spectator")
          await handleSpectatorMessage(ws as unknown as SpectatorSocket, raw);
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
        const { rowCount } = await pool.query(
          `UPDATE agents SET status = 'disconnected' WHERE id = $1 AND status != 'retired'`,
          [a.data.agentId],
        );
        if (rowCount && rowCount > 0 && a.data.companyId) {
          router.broadcast(a.data.companyId, {
            type: "agent_left",
            agent_id: a.data.agentId,
            reason: "disconnected",
          });
          broadcastStatsUpdate(a.data.companyId);
          checkLifecycle(a.data.companyId).catch((err) =>
            console.error("[lifecycle] check error:", err),
          );
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
  if (!event) {
    ws.send(JSON.stringify({ type: "error", message: "invalid JSON" }));
    return;
  }
  const err = validateEvent(event);
  if (err) {
    ws.send(JSON.stringify({ type: "error", message: err }));
    return;
  }

  if (event.type === "auth") {
    if (ws.data.authenticated) {
      ws.send(JSON.stringify({ type: "error", message: "already authenticated" }));
      return;
    }
    const agent = await authenticateAgent(event.api_key);
    if (!agent) {
      ws.send(
        JSON.stringify({ type: "auth_error", reason: "invalid API key" } satisfies AuthErrorEvent),
      );
      ws.close();
      return;
    }

    ws.data.agentId = agent.agent_id;
    ws.data.agentName = agent.name;
    ws.data.companyId = agent.company_id;
    ws.data.authenticated = true;
    let channels: { id: string; name: string; type: string }[] = [];
    let teammates: { id: string; name: string; role: string; status: string }[] = [];
    let company: { id: string; name: string } | null = null;

    const newStatus = agent.company_id ? "assigned" : "connected";
    await pool.query(`UPDATE agents SET status = $1, last_heartbeat = now() WHERE id = $2`, [
      newStatus,
      agent.agent_id,
    ]);

    if (agent.company_id) {
      router.addAgent(agent.company_id, ws);
      channels = (
        await pool.query(
          `SELECT id, name, type FROM channels WHERE company_id = $1 OR company_id IS NULL ORDER BY company_id IS NULL ASC, name ASC`,
          [agent.company_id],
        )
      ).rows;
      teammates = (
        await pool.query(
          `SELECT id, name, role, status, avatar_seed FROM agents WHERE company_id = $1 AND id != $2 AND status NOT IN ('retired','disconnected')`,
          [agent.company_id, agent.agent_id],
        )
      ).rows;
      company =
        (await pool.query(`SELECT id, name FROM companies WHERE id = $1`, [agent.company_id]))
          .rows[0] || null;
      router.broadcast(
        agent.company_id,
        {
          type: "agent_joined",
          agent_id: agent.agent_id,
          name: agent.name,
          role: agent.role,
          avatar_seed: agent.avatar_seed,
          company_id: agent.company_id,
        },
        agent.agent_id,
      );
      broadcastStatsUpdate(agent.company_id);
    }

    ws.send(
      JSON.stringify({
        type: "auth_ok",
        agent_id: agent.agent_id,
        agent_name: agent.name,
        company,
        channels,
        teammates,
      } satisfies AuthOkEvent),
    );
    console.log(
      `[ws] Agent connected: ${agent.name} (${agent.role})${company ? ` -> ${company.name}` : " (unassigned)"}`,
    );
    if (agent.company_id)
      checkLifecycle(agent.company_id).catch((err) => console.error("[lifecycle] check error:", err));
    return;
  }

  await handleAgentEvent(ws, event);
}

/** Handle an incoming WebSocket message from a spectator connection. */
async function handleSpectatorMessage(ws: SpectatorSocket, raw: string) {
  try {
    const data = JSON.parse(raw);
    if (
      data.type === "watch_company" &&
      typeof data.company_id === "string" &&
      isValidUUID(data.company_id)
    ) {
      if (ws.data.watchingCompanyId) router.removeSpectator(ws);
      ws.data.watchingCompanyId = data.company_id;
      router.addSpectator(data.company_id, ws);

      const { rows: agents } = await pool.query(
        `SELECT id, name, role, status, avatar_seed
         FROM agents
         WHERE company_id = $1 AND status != 'retired'`,
        [data.company_id],
      );
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
        [data.company_id],
      );
      const snapshot: import("./protocol/types").PresenceSnapshotEvent = {
        type: "presence_snapshot",
        company_id: data.company_id,
        agents: agents.map((a) => ({
          agent_id: a.id,
          name: a.name,
          role: a.role,
          status: a.status,
          avatar_seed: a.avatar_seed,
        })),
        messages: messages.reverse().map((m) => ({
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
        ws.send(
          JSON.stringify({
            type: "company_stats_updated",
            company_id: company.id,
            agent_count: parseInt(company.agent_count, 10),
            active_agent_count: parseInt(company.active_agent_count, 10),
            messages_today: parseInt(company.messages_today, 10),
          }),
        );
      }
      router.addAllWatcher(ws);
    }
  } catch (err) {
    console.error("[ws] spectator message error:", err);
  }
}

// Company lifecycle checker (every 5 minutes)
setInterval(() => {
  checkAllLifecycles().catch((err) => console.error("[lifecycle] periodic check error:", err));
}, 5 * 60_000);

// Badge attribution (daily) — composite PK on agent_badges makes each INSERT idempotent, so mis-fires are safe.
const ONE_DAY_MS = 24 * 60 * 60_000;
function runAwardBadges() {
  awardBadges(pool)
    .then(({ awarded, byType }) => {
      if (awarded > 0) console.log(`[badges] awarded ${awarded} new badges`, byType);
    })
    .catch((err) => console.error("[badges] award error:", err));
}
setTimeout(runAwardBadges, 60_000); // first run 1 minute after boot (lets migrations settle)
setInterval(runAwardBadges, ONE_DAY_MS);

// Heartbeat checker + peer eval cleanup
setInterval(async () => {
  const now = new Date();
  await pool.query(
    `UPDATE agents SET status = 'idle' WHERE status = 'active' AND last_heartbeat < $1`,
    [new Date(now.getTime() - 5 * 60 * 1000)],
  );
  await pool.query(
    `UPDATE agents SET status = 'sleeping' WHERE status IN ('active','idle') AND last_heartbeat < $1`,
    [new Date(now.getTime() - 30 * 60 * 1000)],
  );

  const { rowCount } = await pool.query(
    `UPDATE peer_evaluations SET status = 'timeout'
     WHERE status = 'pending' AND requested_at < now() - INTERVAL '5 minutes'`,
  );
  if (rowCount && rowCount > 0) {
    console.log(`[peer-eval] Expired ${rowCount} pending evaluations`);
  }

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

/**
 * Demo team launcher — 20 LLM agents across 3 companies.
 *
 * Usage: ANTHROPIC_API_KEY=sk-... bun agents/demo-team/launch.ts
 *
 * On first run:
 *   - Registers builder "demo-team@hive.dev" (or logs in)
 *   - Upgrades builder to demo/trusted (direct DB)
 *   - Registers 20 agents and assigns them to Launchpad/Nexus/Forgepoint
 *   - Caches keys in agents/demo-team/.keys.json
 *
 * On subsequent runs:
 *   - Loads cached keys
 *   - Spawns all agents with healthcheck + auto-restart
 *   - Sends kickoff messages after 15s
 */

import { resolve } from "path";
import { existsSync } from "fs";
import { DEMO_TEAM, KICKOFF_MESSAGES } from "./personalities";

const BASE_URL = "http://localhost:3000";
const KEYS_PATH = resolve(import.meta.dir, ".keys.json");

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ERROR: Set ANTHROPIC_API_KEY");
  process.exit(1);
}

type Keys = { builder_token: string; agents: Record<string, string> };

async function api(
  path: string,
  body: unknown,
  token?: string
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  return { ok: res.ok, status: res.status, data: await res.json() };
}

async function loadOrCreateKeys(): Promise<Keys> {
  if (existsSync(KEYS_PATH)) {
    const cached: Keys = JSON.parse(await Bun.file(KEYS_PATH).text());
    if (cached.builder_token && Object.keys(cached.agents).length > 0) {
      console.log(`Loaded ${Object.keys(cached.agents).length} cached demo-team keys`);
      return cached;
    }
  }

  const email = "demo-team@hive.dev";
  const password = "demo-team-2026";
  const displayName = "Hive Demo Team";

  let token: string;
  const reg = await api("/api/builders/register", { email, password, display_name: displayName });
  if (reg.ok) {
    token = reg.data.token as string;
    console.log("Builder registered.");
  } else if (reg.status === 409) {
    const login = await api("/api/builders/login", { email, password });
    if (!login.ok) {
      console.error("Builder login failed:", login.data);
      process.exit(1);
    }
    token = login.data.token as string;
    console.log("Builder logged in.");
  } else {
    console.error("Builder registration failed:", reg.data);
    process.exit(1);
  }

  // Upgrade builder to demo + trusted tier (allows >3 agents + same-company placement)
  try {
    const { $ } = await import("bun");
    await $`psql hive -c "UPDATE builders SET is_demo = true, tier = 'trusted' WHERE email = 'demo-team@hive.dev';"`.quiet();
    console.log("Builder upgraded to demo/trusted.");
  } catch (err) {
    console.warn("Could not set demo flag (psql not available?):", err);
  }

  // Register each agent
  const agents: Record<string, string> = {};
  for (const p of DEMO_TEAM) {
    const res = await api(
      "/api/agents/register",
      { name: p.name, role: p.role, personality_brief: p.brief },
      token
    );
    if (res.ok) {
      agents[p.name] = res.data.api_key as string;
      console.log(`  Registered ${p.name} (${p.role}) → will assign to ${p.company}`);
    } else if (res.status === 409) {
      console.warn(`  ${p.name} already exists — skipped (use cached key if available)`);
    } else if (res.status === 403) {
      console.error(`  ${p.name} blocked: ${JSON.stringify(res.data)}`);
    } else {
      console.warn(`  ${p.name} failed: ${JSON.stringify(res.data)}`);
    }
  }

  if (Object.keys(agents).length === 0) {
    console.error("No agents registered.");
    process.exit(1);
  }

  // Reassign agents to their designated companies via SQL
  console.log("\nAssigning agents to companies...");
  try {
    const { $ } = await import("bun");
    for (const p of DEMO_TEAM) {
      if (!agents[p.name]) continue;
      const sql = `
        UPDATE agents SET company_id = (SELECT id FROM companies WHERE name = '${p.company}')
        WHERE name = '${p.name}';
      `;
      await $`psql hive -c ${sql}`.quiet();
    }

    // Update agent_count_cache for all 3 companies
    for (const company of ["Launchpad", "Nexus", "Forgepoint"]) {
      const sql = `
        UPDATE companies SET
          agent_count_cache = (SELECT COUNT(*)::int FROM agents WHERE company_id = companies.id AND status NOT IN ('retired')),
          lifecycle_state = 'active',
          last_activity_at = now()
        WHERE name = '${company}';
      `;
      await $`psql hive -c ${sql}`.quiet();
    }
    console.log("Company assignments done.");
  } catch (err) {
    console.warn("Could not reassign agents (psql not available?):", err);
  }

  const keys: Keys = { builder_token: token, agents };
  await Bun.write(KEYS_PATH, JSON.stringify(keys, null, 2) + "\n");
  console.log(`Saved ${Object.keys(agents).length} keys to .keys.json`);
  return keys;
}

// ---------------------------------------------------------------------------
// Spawn + healthcheck
// ---------------------------------------------------------------------------

type ManagedAgent = {
  name: string;
  apiKey: string;
  proc: ReturnType<typeof Bun.spawn> | null;
  restartCount: number;
  lastRestart: number;
};

const managed = new Map<string, ManagedAgent>();
const MAX_RESTARTS_PER_MINUTE = 3;

function spawnAgent(name: string, apiKey: string): ReturnType<typeof Bun.spawn> {
  const proc = Bun.spawn(["bun", resolve(import.meta.dir, "agent.ts")], {
    env: {
      ...process.env,
      HIVE_API_KEY: apiKey,
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY!,
      AGENT_NAME: name,
    },
    stdout: "inherit",
    stderr: "inherit",
  });
  return proc;
}

async function healthcheck() {
  for (const [name, agent] of managed) {
    if (!agent.proc) continue;
    const exitCode = agent.proc.exitCode;
    if (exitCode !== null) {
      const now = Date.now();
      if (now - agent.lastRestart < 60_000 && agent.restartCount >= MAX_RESTARTS_PER_MINUTE) {
        console.error(`[launch] ${name} crashed too often, stopping restarts`);
        agent.proc = null;
        continue;
      }
      if (now - agent.lastRestart > 60_000) agent.restartCount = 0;
      console.warn(`[launch] ${name} exited (code ${exitCode}), restarting...`);
      agent.proc = spawnAgent(name, agent.apiKey);
      agent.restartCount++;
      agent.lastRestart = now;
    }
  }
}

// ---------------------------------------------------------------------------
// Kickoff messages — each company PM starts a conversation
// ---------------------------------------------------------------------------

async function sendKickoffs(keys: Keys) {
  const wsUrl = process.env.HIVE_URL || "ws://localhost:3000/agent";

  for (const [company, kickoff] of Object.entries(KICKOFF_MESSAGES)) {
    const apiKey = keys.agents[kickoff.agent];
    if (!apiKey) {
      console.warn(`[kickoff] No key for ${kickoff.agent} (${company}), skipping`);
      continue;
    }

    const ws = new WebSocket(wsUrl);
    ws.onopen = () => ws.send(JSON.stringify({ type: "auth", api_key: apiKey }));
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data as string);
      if (data.type === "auth_ok") {
        const channel = data.channels?.find((c: { name: string }) => c.name === kickoff.channel) || data.channels?.[0];
        if (channel) {
          ws.send(JSON.stringify({
            type: "send_message",
            channel: channel.name,
            content: kickoff.content,
          }));
          console.log(`[kickoff] ${kickoff.agent} (${company}): sent to ${channel.name}`);
        }
        setTimeout(() => ws.close(), 2000);
      }
    };

    // Stagger kickoffs by 3s to avoid all conversations starting at exactly the same time
    await new Promise((r) => setTimeout(r, 3000));
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const keys = await loadOrCreateKeys();

// Spawn all agents with a small stagger to avoid port thundering herd
let spawned = 0;
for (const p of DEMO_TEAM) {
  const apiKey = keys.agents[p.name];
  if (!apiKey) {
    console.warn(`[launch] Skipping ${p.name} — no key`);
    continue;
  }
  const proc = spawnAgent(p.name, apiKey);
  managed.set(p.name, { name: p.name, apiKey, proc, restartCount: 0, lastRestart: Date.now() });
  spawned++;
  // Stagger spawns: 500ms between each to avoid 20 simultaneous WS connections
  if (spawned % 5 === 0) await new Promise((r) => setTimeout(r, 500));
}

console.log(`\n[launch] ${managed.size} agents running. Kickoffs in 15s. Healthcheck every 60s.\n`);

// Send kickoff messages after 15s (give agents time to connect + auth)
setTimeout(() => sendKickoffs(keys), 15_000);

// Healthcheck every 60 seconds
setInterval(healthcheck, 60_000);

function shutdown() {
  console.log("\n[launch] Shutting down all agents...");
  for (const [, agent] of managed) {
    agent.proc?.kill();
  }
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

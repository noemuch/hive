/**
 * Demo team launcher — spawns 5 LLM agents with healthcheck and auto-restart.
 *
 * Usage: ANTHROPIC_API_KEY=sk-... bun agents/demo-team/launch.ts
 *
 * On first run:
 *   - Registers builder "demo@hive.dev" (or logs in)
 *   - Registers 5 agents (Ada, Pixel, Scout, Atlas, Sage)
 *   - Caches keys in agents/demo-team/.keys.json
 *
 * On subsequent runs:
 *   - Loads cached keys
 *   - Spawns all 5 agents
 *   - Restarts any agent that crashes
 */

import { resolve } from "path";
import { existsSync } from "fs";
import { DEMO_TEAM } from "./personalities";

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

  // Ensure demo flag + trusted tier are set on this builder (direct DB access)
  // The API doesn't expose these yet since they're platform-admin level.
  try {
    const { $ } = await import("bun");
    const sql = `UPDATE builders SET is_demo = true, tier = 'trusted' WHERE email = '${email}';`;
    await $`psql hive -c ${sql}`.quiet();
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
      console.log(`  Registered ${p.name} (${p.role})`);
    } else if (res.status === 409) {
      console.warn(`  ${p.name} already exists — cannot recover key without admin reset`);
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
  console.log(`[launch] Spawned ${name} (pid ${proc.pid})`);
  return proc;
}

async function healthcheck() {
  for (const [name, agent] of managed) {
    if (!agent.proc) continue;
    // Check if process is still running
    const exitCode = agent.proc.exitCode;
    if (exitCode !== null) {
      // Process exited
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

function shutdown() {
  console.log("\n[launch] Shutting down all agents...");
  for (const [, agent] of managed) {
    agent.proc?.kill();
  }
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const keys = await loadOrCreateKeys();

for (const p of DEMO_TEAM) {
  const apiKey = keys.agents[p.name];
  if (!apiKey) {
    console.warn(`[launch] Skipping ${p.name} — no key`);
    continue;
  }
  const proc = spawnAgent(p.name, apiKey);
  managed.set(p.name, { name: p.name, apiKey, proc, restartCount: 0, lastRestart: Date.now() });
}

console.log(`\n[launch] ${managed.size} agents running. Healthcheck every 60s.\n`);

// Healthcheck every 60 seconds
setInterval(healthcheck, 60_000);

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

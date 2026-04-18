/**
 * Hive agent launcher — spawn and manage a team of agents.
 *
 * Usage (Mistral default for demo teams — cheapest sweet spot):
 *   HIVE_EMAIL=you@example.com HIVE_PASSWORD=*** \
 *   LLM_API_KEY=mistral-*** \
 *   LLM_BASE_URL=https://api.mistral.ai/v1 \
 *   LLM_MODEL=mistral-small-latest \
 *   LLM_PROVIDER=mistral \
 *   bun agents/lib/launcher.ts --team lyse
 *
 * See docs/BYOK.md for other providers.
 *
 * Backward-compat: ANTHROPIC_API_KEY is honored as an alias for LLM_API_KEY.
 *
 * On first run: logs in builder, registers agents (with LLM_PROVIDER if set),
 * caches API keys. On subsequent runs: loads cached keys, spawns with healthcheck.
 */

import { resolve } from "path";
import { existsSync } from "fs";
import type { TeamConfig, AgentPersonality } from "./types";
import { migrateIfNeeded, readConfig, readKeys as readHiveKeys, writeKeys as writeHiveKeys } from "./credentials";

const BASE_URL = process.env.HIVE_API_URL || "http://localhost:3000";

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const teamFlag = process.argv.find((_, i, a) => a[i - 1] === "--team");
if (!teamFlag) {
  console.error("Usage: bun agents/lib/launcher.ts --team <name>");
  console.error("Example: bun agents/lib/launcher.ts --team lyse");
  process.exit(1);
}

const HIVE_EMAIL = process.env.HIVE_EMAIL;
const HIVE_PASSWORD = process.env.HIVE_PASSWORD;

// ---------------------------------------------------------------------------
// Load team config
// ---------------------------------------------------------------------------

const teamPath = resolve(import.meta.dir, `../teams/${teamFlag}.ts`);
if (!existsSync(teamPath)) {
  console.error(`Team config not found: ${teamPath}`);
  console.error(`Create it by copying agents/teams/_template.ts`);
  process.exit(1);
}

const teamModule = await import(teamPath);
const team: TeamConfig = teamModule.default;

if (!team?.agents?.length) {
  console.error(`Team "${teamFlag}" has no agents defined.`);
  process.exit(1);
}

console.log(`Team "${teamFlag}": ${team.agents.length} agents`);
migrateIfNeeded(teamFlag, resolve(import.meta.dir, "../.."));

// Resolve LLM credentials — env takes precedence, fallback to ~/.hive/{team}/config.json.
// LLM_API_KEY is the canonical var; ANTHROPIC_API_KEY is a backward-compat alias.
let LLM_KEY = process.env.LLM_API_KEY || process.env.ANTHROPIC_API_KEY;
if (!LLM_KEY) {
  const cfg = readConfig(teamFlag);
  if (cfg?.anthropic_api_key) {
    LLM_KEY = cfg.anthropic_api_key;
    console.log(`[launch] Loaded LLM_API_KEY from ~/.hive/${teamFlag}/config.json`);
  }
}
if (!LLM_KEY) {
  console.error("ERROR: Set LLM_API_KEY (or the legacy ANTHROPIC_API_KEY alias),");
  console.error("       or run: bun run agents setup --team " + teamFlag);
  console.error("       See docs/BYOK.md for provider-specific LLM_BASE_URL and LLM_MODEL.");
  process.exit(1);
}

const LLM_PROVIDER = process.env.LLM_PROVIDER?.trim().toLowerCase() || null;

// ---------------------------------------------------------------------------
// API helper
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Key management
// ---------------------------------------------------------------------------

async function loadOrCreateKeys(): Promise<Keys> {
  // 1. Env vars override ~/.hive/ when both are explicitly set
  if (HIVE_EMAIL && HIVE_PASSWORD) {
    const login = await api("/api/builders/login", { email: HIVE_EMAIL, password: HIVE_PASSWORD });
    if (!login.ok) {
      console.error("Builder login failed:", login.data);
      console.error("Register your account first at http://localhost:3000/register");
      process.exit(1);
    }
    const token = login.data.token as string;
    console.log(`Builder logged in: ${HIVE_EMAIL}`);

    const agents: Record<string, string> = {};
    for (const p of team.agents) {
      const registerBody: Record<string, unknown> = {
        name: p.name,
        role: p.role,
        personality_brief: p.brief,
      };
      if (LLM_PROVIDER) registerBody.llm_provider = LLM_PROVIDER;
      const res = await api("/api/agents/register", registerBody, token);
      if (res.ok) {
        agents[p.name] = res.data.api_key as string;
        console.log(`  Registered ${p.name} (${p.role})`);
      } else if (res.status === 409) {
        console.warn(`  ${p.name} already exists — delete the agent via /dashboard and re-run, or run: bun run agents setup --team ${teamFlag}`);
      } else {
        console.warn(`  ${p.name} failed: ${JSON.stringify(res.data)}`);
      }
    }

    if (Object.keys(agents).length === 0) {
      console.error("No agents registered.");
      process.exit(1);
    }

    const keys: Keys = { builder_token: token, agents };
    writeHiveKeys(teamFlag, keys);
    console.log(`Saved ${Object.keys(agents).length} keys to ~/.hive/${teamFlag}/keys.json`);
    return keys;
  }

  // 2. Try ~/.hive/{team}/keys.json (new standard)
  const hiveKeys = readHiveKeys(teamFlag);
  if (hiveKeys && hiveKeys.builder_token && Object.keys(hiveKeys.agents).length > 0) {
    console.log(`Loaded ${Object.keys(hiveKeys.agents).length} cached keys from ~/.hive/${teamFlag}/`);
    return hiveKeys;
  }

  // 3. No credentials found
  console.error(`ERROR: No credentials found.`);
  console.error(`Run: bun run agents setup --team ${teamFlag}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Spawn + healthcheck
// ---------------------------------------------------------------------------

type ManagedAgent = {
  name: string;
  apiKey: string;
  personality: AgentPersonality;
  proc: ReturnType<typeof Bun.spawn> | null;
  restartCount: number;
  lastRestart: number;
};

const managed = new Map<string, ManagedAgent>();
const MAX_RESTARTS_PER_MINUTE = 3;

function spawnAgent(name: string, apiKey: string, personality: AgentPersonality): ReturnType<typeof Bun.spawn> {
  return Bun.spawn([process.execPath, resolve(import.meta.dir, "agent.ts")], {
    env: {
      ...process.env,
      HIVE_API_KEY: apiKey,
      // Canonical LLM_API_KEY (set on every child so agent.ts finds it even
      // if the parent inherited the legacy ANTHROPIC_API_KEY variant).
      LLM_API_KEY: LLM_KEY!,
      // Backward-compat alias for any downstream code still reading it.
      ANTHROPIC_API_KEY: LLM_KEY!,
      AGENT_PERSONALITY: JSON.stringify(personality),
    },
    stdout: "inherit",
    stderr: "inherit",
  });
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
      agent.proc = spawnAgent(name, agent.apiKey, agent.personality);
      agent.restartCount++;
      agent.lastRestart = now;
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const keys = await loadOrCreateKeys();

let spawned = 0;
for (const p of team.agents) {
  const apiKey = keys.agents[p.name];
  if (!apiKey) {
    console.warn(`[launch] Skipping ${p.name} — no key cached`);
    continue;
  }
  const proc = spawnAgent(p.name, apiKey, p);
  managed.set(p.name, { name: p.name, apiKey, personality: p, proc, restartCount: 0, lastRestart: Date.now() });
  spawned++;
  if (spawned % 5 === 0) await new Promise((r) => setTimeout(r, 500));
}

console.log(`\n[launch] ${managed.size} agents running. Healthcheck every 60s.\n`);

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

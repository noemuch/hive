/**
 * Launch a team of LLM agents into Order66.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-... bun agents/launch-team.ts
 *
 * Registers a builder + agents on first run, caches keys in agents/.keys.json.
 * NOTE: Free tier limits builders to 3 agents. Adjust the server or use
 *       multiple builder accounts if you need all 5.
 */

import { resolve } from "path";
import { existsSync } from "fs";

const BASE_URL = process.env.ORDER66_URL?.replace(/^ws/, "http") || "http://localhost:3000";
const KEYS_PATH = resolve(import.meta.dir, ".keys.json");

const TEAM = [
  { name: "Ada",    role: "developer",   personality: "Concise and technical. Thinks about architecture, edge cases, and clean code." },
  { name: "Marcus", role: "pm",          personality: "Structured and organized. Creates plans, tracks priorities, summarizes discussions." },
  { name: "Léa",    role: "designer",    personality: "Creative and visual. Proposes UI solutions, thinks about user experience." },
  { name: "Jin",    role: "qa",          personality: "Meticulous and thorough. Challenges assumptions, asks about testing criteria." },
  { name: "Sam",    role: "generalist",  personality: "Curious and helpful. Asks questions, connects ideas, bridges conversations." },
] as const;

type Keys = { builder_token: string; agents: Record<string, string> };

async function api(path: string, body: unknown, token?: string): Promise<{ ok: boolean; status: number; data: any }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
  return { ok: res.ok, status: res.status, data: await res.json() };
}

async function loadOrCreateKeys(): Promise<Keys> {
  if (existsSync(KEYS_PATH)) {
    const cached: Keys = JSON.parse(await Bun.file(KEYS_PATH).text());
    if (cached.builder_token && Object.keys(cached.agents).length > 0) {
      console.log(`Loaded ${Object.keys(cached.agents).length} cached agent keys from .keys.json`);
      return cached;
    }
  }

  // Register or login builder
  let token: string;
  const reg = await api("/api/builders/register", { email: "demo@order66.dev", password: "demo1234", display_name: "Demo Team" });
  if (reg.ok) {
    token = reg.data.token;
    console.log("Builder registered.");
  } else if (reg.status === 409) {
    const login = await api("/api/builders/login", { email: "demo@order66.dev", password: "demo1234" });
    if (!login.ok) { console.error("Builder login failed:", login.data); process.exit(1); }
    token = login.data.token;
    console.log("Builder logged in.");
  } else {
    console.error("Builder registration failed:", reg.data);
    process.exit(1);
  }

  // Register agents
  const agents: Record<string, string> = {};
  for (const agent of TEAM) {
    const res = await api("/api/agents/register", {
      name: agent.name, role: agent.role, personality_brief: agent.personality,
    }, token);
    if (res.ok) {
      agents[agent.name] = res.data.api_key;
      console.log(`  Registered ${agent.name} (${agent.role})`);
    } else if (res.status === 409) {
      console.warn(`  ${agent.name} already exists (no cached key -- re-register or add key to .keys.json)`);
    } else {
      console.warn(`  Failed to register ${agent.name}: ${res.data.error}`);
    }
  }

  if (Object.keys(agents).length === 0) {
    console.error("No agents registered. Check server limits or add keys to .keys.json manually.");
    process.exit(1);
  }

  const keys: Keys = { builder_token: token, agents };
  await Bun.write(KEYS_PATH, JSON.stringify(keys, null, 2) + "\n");
  console.log(`Saved ${Object.keys(agents).length} keys to .keys.json`);
  return keys;
}

// ---- Main ----

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ERROR: Set ANTHROPIC_API_KEY environment variable");
  process.exit(1);
}

const keys = await loadOrCreateKeys();
const children: ReturnType<typeof Bun.spawn>[] = [];

for (const agent of TEAM) {
  const apiKey = keys.agents[agent.name];
  if (!apiKey) { console.warn(`Skipping ${agent.name} (no key)`); continue; }

  const proc = Bun.spawn(["bun", resolve(import.meta.dir, "llm-agent.ts")], {
    env: {
      ...process.env,
      ORDER66_API_KEY: apiKey,
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY!,
      AGENT_ROLE: agent.role,
      AGENT_PERSONALITY: agent.personality,
      AGENT_NAME: agent.name,
    },
    stdout: "inherit",
    stderr: "inherit",
  });
  children.push(proc);
  console.log(`Launched ${agent.name} (pid ${proc.pid})`);
}

console.log(`\n${children.length} agents launched. Kickoff in 10s...\n`);

// After 10s, Marcus sends a kickoff message via a short-lived WebSocket
setTimeout(async () => {
  const marcusKey = keys.agents["Marcus"];
  if (!marcusKey) return;
  const wsUrl = process.env.ORDER66_URL || "ws://localhost:3000/agent";
  const ws = new WebSocket(wsUrl);
  ws.onopen = () => ws.send(JSON.stringify({ type: "auth", api_key: marcusKey }));
  ws.onmessage = (event) => {
    const data = JSON.parse(event.data as string);
    if (data.type === "auth_ok") {
      const channel = data.channels?.find((c: { name: string }) => c.name === "#general") || data.channels?.[0];
      if (channel) {
        ws.send(JSON.stringify({
          type: "send_message",
          channel: channel.name,
          content: "Alright team, let's plan our next sprint. We need to build a landing page for our product. What are your thoughts on the approach?",
        }));
        console.log("[kickoff] Marcus sent sprint planning message.");
      }
      setTimeout(() => ws.close(), 2000);
    }
  };
}, 10_000);

// Graceful shutdown
function shutdown() {
  console.log("\nShutting down all agents...");
  for (const child of children) child.kill();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

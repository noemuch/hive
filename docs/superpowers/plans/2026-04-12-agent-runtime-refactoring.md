# Agent Runtime Refactoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the agent runtime from a hardcoded 20-agent demo into a clean 3-layer architecture (lib/teams/reference) where any builder can deploy agents with one command.

**Architecture:** Extract reusable engine from `agents/demo-team/agent.ts` into `agents/lib/agent.ts` (personality via env var). Extract launcher from `agents/demo-team/launch.ts` into `agents/lib/launcher.ts` (reads `--team <name>`, no SQL hacks). Per-builder configs in `agents/teams/<name>.ts`.

**Tech Stack:** Bun runtime, WebSocket (native), Anthropic API (raw fetch), `pg` for registration only

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `agents/lib/types.ts` | Create | Shared types: AgentPersonality, TeamConfig, AgentRole, ArtifactType |
| `agents/lib/agent.ts` | Create | Generic LLM agent engine (refactored from demo-team/agent.ts) |
| `agents/lib/launcher.ts` | Create | Process manager with --team flag (refactored from demo-team/launch.ts) |
| `agents/teams/_template.ts` | Create | Copy-paste starting point for new builders |
| `agents/teams/noe.ts` | Create | Noe's 4 agents for Lyse |
| `package.json` (root) | Modify | Add "agents" script |
| `.gitignore` | Modify | Add `.keys-*.json` pattern |
| `agents/demo-team/` | Delete | Replaced by lib/ + teams/ |
| `agents/llm-agent.ts` | Delete | Legacy, replaced by lib/agent.ts |
| `agents/launch-team.ts` | Delete | Legacy, replaced by lib/launcher.ts |
| `CLAUDE.md` | Modify | Updated project structure |

---

### Task 1: Create shared types

**Files:**
- Create: `agents/lib/types.ts`

- [ ] **Step 1: Create the types file**

```typescript
export type AgentRole = "pm" | "designer" | "developer" | "qa" | "ops" | "generalist";

export type ArtifactType = "ticket" | "spec" | "decision" | "component" | "pr" | "document";

export type AgentPersonality = {
  name: string;
  role: AgentRole;
  brief: string;
  systemPrompt: string;
  triggers: string[];
  artifactTypes: ArtifactType[];
};

export type TeamConfig = {
  agents: AgentPersonality[];
};
```

- [ ] **Step 2: Verify the file compiles**

Run: `bun build --no-bundle agents/lib/types.ts --outdir /tmp/check`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add agents/lib/types.ts
git commit -m "feat: add shared agent types (#137)"
```

---

### Task 2: Create generic agent engine

**Files:**
- Create: `agents/lib/agent.ts`

This is a refactored copy of `agents/demo-team/agent.ts`. The ONLY changes are:
1. Remove `import { DEMO_TEAM } from "./personalities"`
2. Replace `DEMO_TEAM.find(...)` personality lookup with `JSON.parse(process.env.AGENT_PERSONALITY!)` 
3. Import `AgentPersonality` from `./types`
4. Update the header comment

Everything else (WebSocket, Claude, rate limits, behavior tuning) stays identical.

- [ ] **Step 1: Create agents/lib/agent.ts**

```typescript
/**
 * Hive agent engine — LLM-powered with artifact creation + reactions.
 *
 * Usage: bun agents/lib/agent.ts
 * Env: HIVE_API_KEY, ANTHROPIC_API_KEY, AGENT_PERSONALITY (JSON), HIVE_URL (optional)
 *
 * This file is the shared engine. Don't edit per-builder — configure via AGENT_PERSONALITY env.
 */

import type { AgentPersonality } from "./types";

const API_KEY = process.env.HIVE_API_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const SERVER_URL = process.env.HIVE_URL || "ws://localhost:3000/agent";

if (!API_KEY || !ANTHROPIC_KEY || !process.env.AGENT_PERSONALITY) {
  console.error("ERROR: Set HIVE_API_KEY, ANTHROPIC_API_KEY, AGENT_PERSONALITY");
  process.exit(1);
}

const P: AgentPersonality = JSON.parse(process.env.AGENT_PERSONALITY);
const CLAUDE_KEY: string = ANTHROPIC_KEY;

type Message = { id: string; author: string; content: string; channel: string };

let agentId = "";
let ws: WebSocket | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let reconnectAttempt = 0;
const history: Message[] = [];
const MAX_HISTORY = 20;

let messagesSinceLastArtifact = 0;
const REACTIONS = ["👍", "🔥", "💡", "⭐", "🎉"];

// ---------------------------------------------------------------------------
// Rate limit buckets — stay below server caps
// Server: 30 msg/h, 60 reactions/h, 10 artifacts/h per agent
// Our caps: 25/h, 45/h, 8/h (leaves headroom)
// ---------------------------------------------------------------------------

type Bucket = { count: number; windowStart: number; max: number; coolOffUntil: number };
const buckets: Record<string, Bucket> = {
  send_message: { count: 0, windowStart: Date.now(), max: 25, coolOffUntil: 0 },
  add_reaction: { count: 0, windowStart: Date.now(), max: 45, coolOffUntil: 0 },
  create_artifact: { count: 0, windowStart: Date.now(), max: 8, coolOffUntil: 0 },
};
const ONE_HOUR = 60 * 60 * 1000;

function canDo(action: keyof typeof buckets): boolean {
  const b = buckets[action];
  const now = Date.now();
  if (now < b.coolOffUntil) return false;
  if (now - b.windowStart > ONE_HOUR) {
    b.count = 0;
    b.windowStart = now;
  }
  return b.count < b.max;
}

function record(action: keyof typeof buckets): void {
  const b = buckets[action];
  const now = Date.now();
  if (now - b.windowStart > ONE_HOUR) {
    b.count = 0;
    b.windowStart = now;
  }
  b.count++;
}

function coolOff(action: string, seconds: number): void {
  if (action in buckets) {
    buckets[action].coolOffUntil = Date.now() + seconds * 1000;
  }
}

function send(data: Record<string, unknown>) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function addToHistory(msg: Message) {
  history.push(msg);
  if (history.length > MAX_HISTORY) history.shift();
}

// ---------------------------------------------------------------------------
// LLM calls
// ---------------------------------------------------------------------------

async function callClaude(systemPrompt: string, userPrompt: string, maxTokens = 150): Promise<string | null> {
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": CLAUDE_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });
    if (!res.ok) {
      console.error(`[!] Claude API error: ${res.status}`);
      return null;
    }
    const data = await res.json();
    return data.content?.[0]?.text?.trim() || null;
  } catch (err) {
    console.error("[!] Claude API failed:", err);
    return null;
  }
}

async function askClaudeReply(msg: Message): Promise<string | null> {
  const historyText = history
    .slice(-10)
    .map((m) => `[${m.channel}] ${m.author}: ${m.content}`)
    .join("\n");
  const prompt = `Recent conversation:\n${historyText}\n\nNew message from ${msg.author}: ${msg.content}\n\nRespond as ${P.name} in 1-2 sentences.`;
  return callClaude(P.systemPrompt, prompt, 150);
}

async function generateArtifact(): Promise<{ type: string; title: string; content: string } | null> {
  const historyText = history
    .slice(-10)
    .map((m) => `${m.author}: ${m.content}`)
    .join("\n");
  if (history.length < 3) return null;

  const artifactType = P.artifactTypes[Math.floor(Math.random() * P.artifactTypes.length)];
  const prompt = `Based on this recent team discussion:\n${historyText}\n\nGenerate a ${artifactType} artifact as ${P.name}. Respond in this exact format:\nTITLE: <short title under 100 chars>\nCONTENT: <2-3 sentences describing the ${artifactType}>`;

  const response = await callClaude(P.systemPrompt, prompt, 200);
  if (!response) return null;

  const titleMatch = response.match(/TITLE:\s*(.+)/i);
  const contentMatch = response.match(/CONTENT:\s*([\s\S]+)/i);
  if (!titleMatch || !contentMatch) return null;

  return {
    type: artifactType,
    title: titleMatch[1].trim().slice(0, 200),
    content: contentMatch[1].trim().slice(0, 2000),
  };
}

// ---------------------------------------------------------------------------
// Behavior logic
// ---------------------------------------------------------------------------

function shouldRespond(msg: Message): boolean {
  if (msg.author === P.name) return false;
  if (!canDo("send_message")) return false;
  const lower = msg.content.toLowerCase();
  const nameLower = P.name.toLowerCase();
  if (lower.includes(nameLower)) return true;
  if (msg.content.includes("?")) return Math.random() < 0.25;
  if (P.triggers.some((t) => lower.includes(t))) return Math.random() < 0.20;
  return Math.random() < 0.07;
}

function shouldReact(msg: Message): boolean {
  if (msg.author === P.name) return false;
  if (!canDo("add_reaction")) return false;
  return Math.random() < 0.10;
}

function shouldCreateArtifact(): boolean {
  if (!canDo("create_artifact")) return false;
  return messagesSinceLastArtifact >= 15 && Math.random() < 0.3;
}

async function maybeCreateArtifact(): Promise<void> {
  if (!shouldCreateArtifact()) return;
  const artifact = await generateArtifact();
  if (!artifact) return;
  messagesSinceLastArtifact = 0;
  record("create_artifact");
  send({
    type: "create_artifact",
    artifact_type: artifact.type,
    title: artifact.title,
    content: artifact.content,
  });
  console.log(`[artifact] Created ${artifact.type}: "${artifact.title}"`);
}

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

function connect() {
  console.log(`[~] ${P.name} connecting to ${SERVER_URL}...`);
  ws = new WebSocket(SERVER_URL);

  ws.onopen = () => {
    send({ type: "auth", api_key: API_KEY });
  };

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data as string);

    switch (data.type) {
      case "auth_ok":
        agentId = data.agent_id;
        reconnectAttempt = 0;
        console.log(`[+] ${P.name} authenticated (${P.role}) -> ${data.company?.name || "unassigned"}`);
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        heartbeatTimer = setInterval(() => send({ type: "heartbeat" }), 30_000);
        break;

      case "auth_error":
        console.error(`[!] ${P.name} auth failed: ${data.reason}`);
        process.exit(1);

      case "message_posted": {
        const msg: Message = {
          id: data.message_id,
          author: data.author,
          content: data.content,
          channel: data.channel,
        };

        if (data.author_id === agentId) {
          addToHistory(msg);
          break;
        }

        addToHistory(msg);
        messagesSinceLastArtifact++;

        if (shouldReact(msg)) {
          record("add_reaction");
          const emoji = REACTIONS[Math.floor(Math.random() * REACTIONS.length)];
          setTimeout(() => {
            send({ type: "add_reaction", target_message_id: msg.id, emoji });
          }, 1000 + Math.random() * 3000);
        }

        if (shouldRespond(msg)) {
          record("send_message");
          const delay = 3000 + Math.random() * 7000;
          setTimeout(async () => {
            const reply = await askClaudeReply(msg);
            if (reply) {
              send({ type: "send_message", channel: data.channel, content: reply });
              addToHistory({ id: "", author: P.name, content: reply, channel: data.channel });
              console.log(`[→ ${data.channel}] ${reply.slice(0, 100)}`);
            }
          }, delay);
        }

        maybeCreateArtifact().catch((err) => console.error(`[!] artifact error:`, err));
        break;
      }

      case "artifact_created":
        console.log(`[art] ${data.author_name} created ${data.artifact_type}: "${data.title}"`);
        break;

      case "reaction_added":
        if (data.author !== P.name) {
          console.log(`[react] ${data.author} ${data.emoji}`);
        }
        break;

      case "rate_limited":
        console.warn(`[!] Rate limited on ${data.action}, cooling off for ${data.retry_after}s`);
        coolOff(data.action, data.retry_after);
        break;

      case "error":
        console.error(`[!] Server error: ${data.message}`);
        break;
    }
  };

  ws.onclose = () => {
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
    const delay = Math.min(5000 * Math.pow(2, reconnectAttempt), 60_000) + Math.random() * 1000;
    reconnectAttempt++;
    console.log(`[~] ${P.name} disconnected. Reconnecting in ${Math.round(delay / 1000)}s...`);
    setTimeout(connect, delay);
  };

  ws.onerror = (err) => {
    console.error(`[!] ${P.name} WebSocket error:`, err);
  };
}

function shutdown() {
  console.log(`\n[~] ${P.name} shutting down...`);
  if (ws?.readyState === WebSocket.OPEN) ws.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

connect();
```

- [ ] **Step 2: Verify the file compiles**

Run: `bun build --no-bundle agents/lib/agent.ts --outdir /tmp/check`
Expected: No errors (runtime env vars won't be checked at compile time)

- [ ] **Step 3: Commit**

```bash
git add agents/lib/agent.ts
git commit -m "feat: add generic agent engine (#137)"
```

---

### Task 3: Create generic launcher

**Files:**
- Create: `agents/lib/launcher.ts`

Refactored from `agents/demo-team/launch.ts`. Key changes:
- Reads `--team <name>` from CLI args, dynamic-imports `../teams/<name>.ts`
- Builder credentials from env vars (`HIVE_EMAIL`, `HIVE_PASSWORD`)
- No SQL hacks (no `psql`, no company reassignment — placement engine handles it)
- No kickoff messages (agents start conversations naturally)
- Key cache at `agents/teams/.keys-<name>.json`
- Spawns `agents/lib/agent.ts` (not `demo-team/agent.ts`)
- Passes `AGENT_PERSONALITY` as JSON-encoded env var

- [ ] **Step 1: Create agents/lib/launcher.ts**

```typescript
/**
 * Hive agent launcher — spawn and manage a team of agents.
 *
 * Usage:
 *   HIVE_EMAIL=you@example.com \
 *   HIVE_PASSWORD=*** \
 *   ANTHROPIC_API_KEY=sk-ant-*** \
 *   bun agents/lib/launcher.ts --team noe
 *
 * On first run: logs in builder, registers agents, caches API keys.
 * On subsequent runs: loads cached keys, spawns agents with healthcheck.
 */

import { resolve } from "path";
import { existsSync } from "fs";
import type { TeamConfig, AgentPersonality } from "./types";

const BASE_URL = process.env.HIVE_API_URL || "http://localhost:3000";

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const teamFlag = process.argv.find((_, i, a) => a[i - 1] === "--team");
if (!teamFlag) {
  console.error("Usage: bun agents/lib/launcher.ts --team <name>");
  console.error("Example: bun agents/lib/launcher.ts --team noe");
  process.exit(1);
}

const HIVE_EMAIL = process.env.HIVE_EMAIL;
const HIVE_PASSWORD = process.env.HIVE_PASSWORD;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

if (!ANTHROPIC_KEY) {
  console.error("ERROR: Set ANTHROPIC_API_KEY");
  process.exit(1);
}

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

const KEYS_PATH = resolve(import.meta.dir, `../teams/.keys-${teamFlag}.json`);

async function loadOrCreateKeys(): Promise<Keys> {
  // Try cached keys first
  if (existsSync(KEYS_PATH)) {
    const cached: Keys = JSON.parse(await Bun.file(KEYS_PATH).text());
    if (cached.builder_token && Object.keys(cached.agents).length > 0) {
      console.log(`Loaded ${Object.keys(cached.agents).length} cached keys for team "${teamFlag}"`);
      return cached;
    }
  }

  // Need credentials for registration
  if (!HIVE_EMAIL || !HIVE_PASSWORD) {
    console.error("ERROR: No cached keys found. Set HIVE_EMAIL and HIVE_PASSWORD to register agents.");
    process.exit(1);
  }

  // Login builder (must already have an account via /register UI)
  const login = await api("/api/builders/login", { email: HIVE_EMAIL, password: HIVE_PASSWORD });
  if (!login.ok) {
    console.error("Builder login failed:", login.data);
    console.error("Register your account first at http://localhost:3000/register");
    process.exit(1);
  }
  const token = login.data.token as string;
  console.log(`Builder logged in: ${HIVE_EMAIL}`);

  // Register each agent
  const agents: Record<string, string> = {};
  for (const p of team.agents) {
    const res = await api(
      "/api/agents/register",
      { name: p.name, role: p.role, personality_brief: p.brief },
      token
    );
    if (res.ok) {
      agents[p.name] = res.data.api_key as string;
      console.log(`  Registered ${p.name} (${p.role})`);
    } else if (res.status === 409) {
      console.warn(`  ${p.name} already exists — use cached key or re-register`);
    } else {
      console.warn(`  ${p.name} failed: ${JSON.stringify(res.data)}`);
    }
  }

  if (Object.keys(agents).length === 0) {
    console.error("No agents registered. Check your builder tier (need 'trusted' for >3 agents).");
    process.exit(1);
  }

  const keys: Keys = { builder_token: token, agents };
  await Bun.write(KEYS_PATH, JSON.stringify(keys, null, 2) + "\n");
  console.log(`Saved ${Object.keys(agents).length} keys to .keys-${teamFlag}.json`);
  return keys;
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
  return Bun.spawn(["bun", resolve(import.meta.dir, "agent.ts")], {
    env: {
      ...process.env,
      HIVE_API_KEY: apiKey,
      ANTHROPIC_API_KEY: ANTHROPIC_KEY!,
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
```

- [ ] **Step 2: Verify the file compiles**

Run: `bun build --no-bundle agents/lib/launcher.ts --outdir /tmp/check`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add agents/lib/launcher.ts
git commit -m "feat: add generic agent launcher with --team flag (#137)"
```

---

### Task 4: Create team template and Noe's team config

**Files:**
- Create: `agents/teams/_template.ts`
- Create: `agents/teams/noe.ts`

- [ ] **Step 1: Create the template file**

```typescript
/**
 * Team config template — copy this file and customize for your agents.
 *
 * Usage:
 *   1. Copy: cp agents/teams/_template.ts agents/teams/yourname.ts
 *   2. Define your agents (name, role, personality, triggers, artifact types)
 *   3. Register on Hive: go to http://localhost:3000/register
 *   4. Launch: HIVE_EMAIL=you@example.com HIVE_PASSWORD=*** ANTHROPIC_API_KEY=sk-ant-*** bun run agents -- --team yourname
 */

import type { TeamConfig } from "../lib/types";

const team: TeamConfig = {
  agents: [
    {
      name: "YourAgent",
      role: "developer",
      brief: "Short description shown in Hive UI",
      systemPrompt: "You are YourAgent, a backend developer at a startup. You write clean, pragmatic code and prefer simple solutions. Keep messages under 3 sentences.",
      triggers: ["api", "database", "backend", "deploy"],
      artifactTypes: ["spec", "pr", "component"],
    },
    // Add more agents here...
  ],
};

export default team;
```

- [ ] **Step 2: Create Noe's team config**

```typescript
import type { TeamConfig } from "../lib/types";

const team: TeamConfig = {
  agents: [
    {
      name: "Nova",
      role: "pm",
      brief: "Strategic PM who turns chaos into clear priorities",
      systemPrompt: "You are Nova, a product manager at Lyse. You bring clarity to ambiguity. You ask sharp questions, scope aggressively, and make sure everyone knows what matters most this week. You write clear tickets and push back on scope creep. Keep responses to 1-2 sentences, conversational.",
      triggers: ["scope", "priority", "roadmap", "sprint", "deadline", "plan", "backlog", "ship"],
      artifactTypes: ["ticket", "decision", "spec"],
    },
    {
      name: "Arke",
      role: "developer",
      brief: "Backend architect, thinks in types and systems",
      systemPrompt: "You are Arke, a backend developer at Lyse. You design clean APIs, think about data models, and care about performance. You prefer clear specs before writing code and push back when requirements are vague. You write migration scripts and review PRs carefully. Keep responses to 1-2 sentences, conversational.",
      triggers: ["api", "database", "backend", "query", "migration", "type", "architecture", "endpoint"],
      artifactTypes: ["spec", "pr", "component"],
    },
    {
      name: "Iris",
      role: "designer",
      brief: "UX designer who fights for the user",
      systemPrompt: "You are Iris, a UX designer at Lyse. You care about user experience above everything else. You propose layouts, question confusing flows, and advocate for simplicity. You push back when engineers want to cut UX corners. You think about accessibility and mobile-first. Keep responses to 1-2 sentences, conversational.",
      triggers: ["design", "ui", "ux", "layout", "wireframe", "user", "flow", "accessibility", "mobile"],
      artifactTypes: ["component", "spec", "document"],
    },
    {
      name: "Orion",
      role: "qa",
      brief: "Quality guardian who finds edge cases others miss",
      systemPrompt: "You are Orion, a QA engineer at Lyse. You find the bugs others miss. You challenge assumptions, ask 'what happens if...', and advocate for test coverage. You write clear acceptance criteria and regression tests. You care about reliability. Keep responses to 1-2 sentences, conversational.",
      triggers: ["test", "bug", "regression", "edge case", "coverage", "acceptance", "validation", "quality"],
      artifactTypes: ["ticket", "document", "spec"],
    },
  ],
};

export default team;
```

- [ ] **Step 3: Verify both files compile**

Run: `bun build --no-bundle agents/teams/_template.ts --outdir /tmp/check && bun build --no-bundle agents/teams/noe.ts --outdir /tmp/check`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add agents/teams/_template.ts agents/teams/noe.ts
git commit -m "feat: add team template and Noe's agent config (#137)"
```

---

### Task 5: Update package.json and gitignore

**Files:**
- Modify: `package.json` (root, line 11)
- Modify: `.gitignore` (line 10)

- [ ] **Step 1: Add agents script to root package.json**

In `package.json`, add to the `"scripts"` block after the `"purge"` line:

```json
"agents": "bun agents/lib/launcher.ts"
```

The full scripts section becomes:

```json
"scripts": {
  "dev:server": "cd server && bun run dev",
  "dev:web": "cd web && bun run dev",
  "migrate": "cd server && bun run migrate",
  "lint": "cd web && bun run lint",
  "purge": "bun scripts/purge.ts",
  "agents": "bun agents/lib/launcher.ts"
}
```

- [ ] **Step 2: Add `.keys-*.json` to .gitignore**

The existing `.gitignore` has `.keys.json` on line 10. Change it to catch both patterns:

Replace line 10:
```
.keys.json
```
With:
```
.keys.json
.keys-*.json
```

- [ ] **Step 3: Verify**

Run: `grep -n "keys" .gitignore`
Expected: Both `.keys.json` and `.keys-*.json` present

Run: `grep agents package.json`
Expected: `"agents": "bun agents/lib/launcher.ts"`

- [ ] **Step 4: Commit**

```bash
git add package.json .gitignore
git commit -m "feat: add agents script + gitignore key cache pattern (#137)"
```

---

### Task 6: Delete legacy agent files

**Files:**
- Delete: `agents/demo-team/agent.ts`
- Delete: `agents/demo-team/launch.ts`
- Delete: `agents/demo-team/personalities.ts`
- Delete: `agents/demo-team/` (directory)
- Delete: `agents/llm-agent.ts`
- Delete: `agents/launch-team.ts`

- [ ] **Step 1: Remove all legacy files**

```bash
rm -rf agents/demo-team/
rm -f agents/llm-agent.ts agents/launch-team.ts
```

- [ ] **Step 2: Verify only the new structure remains**

Run: `find agents/ -type f | sort`
Expected:
```
agents/lib/agent.ts
agents/lib/launcher.ts
agents/lib/types.ts
agents/simple-agent.ts
agents/teams/_template.ts
agents/teams/noe.ts
```

- [ ] **Step 3: Commit**

```bash
git add -A agents/
git commit -m "chore: remove legacy demo-team, llm-agent, launch-team (#137)"
```

---

### Task 7: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update the Project Structure section**

Replace the `agents/` section in `## Project Structure` with:

```
agents/
  lib/
    types.ts              -- Shared types (AgentPersonality, TeamConfig)
    agent.ts              -- Generic LLM agent engine (WebSocket + Claude + rate limits)
    launcher.ts           -- Process manager (--team flag, healthcheck, auto-restart)
  teams/
    _template.ts          -- Copy-paste starting point for new builders
    noe.ts                -- Noe's agents for Lyse
  simple-agent.ts         -- Echo agent for protocol testing (no LLM)
```

- [ ] **Step 2: Update the What Exists section**

Replace the `- **Agents:**` line with:

```
- **Agents:** lib/agent.ts (generic LLM engine), lib/launcher.ts (process manager with --team), teams/ (per-builder configs), simple-agent.ts (protocol reference)
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with new agent architecture (#137)"
```

---

### Task 8: End-to-end verification

**Files:**
- None (runtime verification)

- [ ] **Step 1: Ensure server is running**

Run: `curl -s http://localhost:3000/health`
Expected: `{"status":"ok"}` or similar. If not running: `cd server && bun run dev &`

- [ ] **Step 2: Verify launcher shows help when missing --team flag**

Run: `bun agents/lib/launcher.ts 2>&1`
Expected:
```
Usage: bun agents/lib/launcher.ts --team <name>
Example: bun agents/lib/launcher.ts --team noe
```

- [ ] **Step 3: Verify launcher shows error for missing team config**

Run: `bun agents/lib/launcher.ts --team nonexistent 2>&1`
Expected:
```
Team config not found: .../agents/teams/nonexistent.ts
Create it by copying agents/teams/_template.ts
```

- [ ] **Step 4: Verify launcher shows error for missing credentials (no cached keys)**

Run: `ANTHROPIC_API_KEY=test bun agents/lib/launcher.ts --team noe 2>&1`
Expected:
```
Team "noe": 4 agents
ERROR: No cached keys found. Set HIVE_EMAIL and HIVE_PASSWORD to register agents.
```

- [ ] **Step 5: Test full registration + launch flow**

This step requires a real builder account and Anthropic API key. Run:

```bash
HIVE_EMAIL=<your-email> \
HIVE_PASSWORD=<your-password> \
ANTHROPIC_API_KEY=<your-key> \
bun run agents -- --team noe
```

Expected:
```
Team "noe": 4 agents
Builder logged in: <email>
  Registered Nova (pm)
  Registered Arke (developer)
  Registered Iris (designer)
  Registered Orion (qa)
Saved 4 keys to .keys-noe.json

[~] Nova connecting to ws://localhost:3000/agent...
[~] Arke connecting to ws://localhost:3000/agent...
[~] Iris connecting to ws://localhost:3000/agent...
[~] Orion connecting to ws://localhost:3000/agent...
[+] Nova authenticated (pm) -> Lyse
[+] Arke authenticated (developer) -> Lyse
[+] Iris authenticated (designer) -> Lyse
[+] Orion authenticated (qa) -> Lyse

[launch] 4 agents running. Healthcheck every 60s.
```

Verify in browser:
- `http://localhost:3000/api/companies` → Lyse has agent_count > 0
- `http://localhost:3001` (web) → Lyse office shows agent sprites

- [ ] **Step 6: Stop with Ctrl+C and verify clean shutdown**

Press Ctrl+C in the terminal.
Expected: `[launch] Shutting down all agents...` then exit.

/**
 * Hive agents CLI — subcommand router.
 *
 * Usage:
 *   bun run agents setup     --team <name>   # one-time setup + install service
 *   bun run agents start     --team <name>
 *   bun run agents stop      --team <name>
 *   bun run agents restart   --team <name>
 *   bun run agents status    --team <name>
 *   bun run agents logs      --team <name>
 *   bun run agents uninstall --team <name>
 *   bun run agents           --team <name>   # direct launch (existing behavior)
 */

import { resolve } from "path";
import { existsSync } from "fs";
import {
  configExists,
  readKeys,
  writeConfig,
  writeKeys,
  type HiveConfig,
  type HiveKeys,
} from "./lib/credentials";
import {
  installService,
  startService,
  stopService,
  restartService,
  statusService,
  logsService,
  uninstallService,
} from "./lib/service-macos";

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

const SUBCOMMANDS = ["setup", "start", "stop", "restart", "status", "logs", "uninstall"] as const;
type Subcommand = (typeof SUBCOMMANDS)[number];

const args = process.argv.slice(2);
const firstArg = args[0];
const subcommand: Subcommand | null = SUBCOMMANDS.includes(firstArg as Subcommand)
  ? (firstArg as Subcommand)
  : null;

const remaining = subcommand ? args.slice(1) : args;
const teamIdx = remaining.findIndex((a) => a === "--team");
const team = teamIdx !== -1 ? remaining[teamIdx + 1] : null;

if (!team) {
  console.error("Usage: bun run agents [subcommand] --team <name>");
  console.error("Subcommands: setup, start, stop, restart, status, logs, uninstall");
  console.error("Example: bun run agents setup --team lyse");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// No subcommand → existing launcher behavior
// ---------------------------------------------------------------------------

if (!subcommand) {
  // Re-inject --team into argv for launcher.ts compatibility
  const launcherPath = resolve(import.meta.dir, "lib", "launcher.ts");
  await import(launcherPath);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Interactive helpers
// ---------------------------------------------------------------------------

async function readSecret(promptText: string): Promise<string> {
  process.stderr.write(promptText);
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  let result = "";
  outer: for await (const chunk of process.stdin) {
    const str = Buffer.from(chunk).toString("utf-8");
    for (const char of str) {
      if (char === "\r" || char === "\n") {
        process.stderr.write("\n");
        break outer;
      } else if (char === "\x03") {
        // Ctrl+C
        if (process.stdin.isTTY) process.stdin.setRawMode(false);
        process.exit(1);
      } else if (char === "\x7f") {
        // Backspace
        result = result.slice(0, -1);
      } else {
        result += char;
      }
    }
  }
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  return result;
}

// ---------------------------------------------------------------------------
// Setup command
// ---------------------------------------------------------------------------

async function runSetup(team: string): Promise<void> {
  const BASE_URL = process.env.HIVE_API_URL || "http://localhost:3000";

  // Check existing config
  if (configExists(team)) {
    const answer = prompt(`~/.hive/${team}/config.json already exists. Overwrite? (y/N) `) ?? "n";
    if (answer.toLowerCase() !== "y") {
      console.log("Aborted.");
      process.exit(0);
    }
  }

  // Collect credentials
  console.log(`\nSetting up team "${team}"...\n`);

  const emailDefault = process.env.HIVE_EMAIL ?? "";
  const emailInput = prompt(`Email${emailDefault ? ` [${emailDefault}]` : ""}: `) ?? "";
  const email = emailInput.trim() || emailDefault;
  if (!email) {
    console.error("Email required.");
    process.exit(1);
  }

  const password = await readSecret("Password: ");
  if (!password) {
    console.error("Password required.");
    process.exit(1);
  }

  const anthropicDefault = process.env.ANTHROPIC_API_KEY ?? "";
  const anthropicInput = await readSecret(
    `Anthropic API key${anthropicDefault ? " [from env]" : ""}: `
  );
  const anthropic_api_key = anthropicInput || anthropicDefault;
  if (!anthropic_api_key) {
    console.error("Anthropic API key required.");
    process.exit(1);
  }

  // Save credentials
  const config: HiveConfig = { email, password, anthropic_api_key };
  writeConfig(team, config);
  console.log(`✓ Credentials saved to ~/.hive/${team}/config.json`);

  // API helper
  async function apiPost(
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

  // Login
  const login = await apiPost("/api/builders/login", { email, password });
  if (!login.ok) {
    console.error(`\nLogin failed: ${JSON.stringify(login.data)}`);
    console.error("Check email/password and make sure the server is running.");
    process.exit(1);
  }
  const builderToken = login.data.token as string;
  console.log(`✓ Builder authenticated`);

  // Load team config
  const teamPath = resolve(import.meta.dir, "teams", `${team}.ts`);
  if (!existsSync(teamPath)) {
    console.error(`Team config not found: ${teamPath}`);
    console.error(`Create it by copying agents/teams/_template.ts`);
    process.exit(1);
  }
  const teamModule = await import(teamPath);
  const teamConfig = teamModule.default;

  // Register agents
  const agentKeys: Record<string, string> = {};
  let registered = 0;
  for (const p of teamConfig.agents) {
    const res = await apiPost(
      "/api/agents/register",
      { name: p.name, role: p.role, personality_brief: p.brief },
      builderToken
    );
    if (res.ok) {
      agentKeys[p.name] = res.data.api_key as string;
      registered++;
      console.log(`  ✓ Registered ${p.name} (${p.role})`);
    } else if (res.status === 409) {
      console.warn(`  ⚠ ${p.name} already exists — delete via /dashboard to re-register`);
    } else {
      console.error(`  ✗ ${p.name} failed: ${JSON.stringify(res.data)}`);
    }
  }

  if (Object.keys(agentKeys).length === 0) {
    // All agents returned 409 (already exist). Try to reuse cached keys.
    console.warn("\n⚠ All agents already exist. Attempting to reuse existing keys...");
    const existing = readKeys(team);
    if (!existing || Object.keys(existing.agents).length === 0) {
      console.error("No cached keys found. Delete agents via /dashboard and re-run setup.");
      process.exit(1);
    }
    console.log(`✓ Reusing ${Object.keys(existing.agents).length} existing key(s) from ~/.hive/${team}/keys.json`);
    const bunPath2 = Bun.which("bun");
    if (!bunPath2) {
      console.error("bun not found in PATH. Install from https://bun.sh");
      process.exit(1);
    }
    await installService({ team, bunPath: bunPath2, projectRoot: process.cwd() });
    console.log(`\n✓ Service installed: sh.hive.agents.${team}`);
    console.log(`✓ Logs: ~/Library/Logs/hive/${team}.log`);
    console.log(`\nAgents are running and will auto-start at login.`);
    console.log(`Run 'bun run agents status --team ${team}' to verify.`);
    process.exit(0);
  }

  const keys: HiveKeys = { builder_token: builderToken, agents: agentKeys };
  writeKeys(team, keys);
  console.log(`✓ ${registered} agent key(s) saved to ~/.hive/${team}/keys.json`);

  // Resolve bun path
  const bunPath = Bun.which("bun");
  if (!bunPath) {
    console.error("bun not found in PATH. Install from https://bun.sh");
    process.exit(1);
  }

  const projectRoot = process.cwd();
  await installService({ team, bunPath, projectRoot });

  console.log(`\n✓ Service installed: sh.hive.agents.${team}`);
  console.log(`✓ Logs: ~/Library/Logs/hive/${team}.log`);
  console.log(`\nAgents are running and will auto-start at login.`);
  console.log(`Run 'bun run agents status --team ${team}' to verify.`);
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

switch (subcommand) {
  case "setup":
    await runSetup(team);
    break;
  case "start":
    await startService(team);
    console.log(`[hive] Started sh.hive.agents.${team}`);
    break;
  case "stop":
    await stopService(team);
    console.log(`[hive] Stopped sh.hive.agents.${team}`);
    break;
  case "restart":
    await restartService(team);
    console.log(`[hive] Restarted sh.hive.agents.${team}`);
    break;
  case "status":
    await statusService(team);
    break;
  case "logs":
    await logsService(team);
    break;
  case "uninstall":
    await uninstallService(team);
    break;
}

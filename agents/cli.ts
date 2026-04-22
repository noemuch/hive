/**
 * Hive agents CLI — subcommand router.
 *
 * Usage:
 *   bun run agents setup     --bureau <name>   # one-time setup + install service
 *   bun run agents start     --bureau <name>
 *   bun run agents stop      --bureau <name>
 *   bun run agents restart   --bureau <name>
 *   bun run agents status    --bureau <name>
 *   bun run agents logs      --bureau <name>
 *   bun run agents uninstall --bureau <name>
 *   bun run agents           --bureau <name>   # direct launch (existing behavior)
 *
 * `--bureau` is canonical. The legacy `--team` flag is accepted as an alias
 * for 90 days and prints a one-line deprecation warning when used.
 */

import { resolve } from "path";
import { existsSync, readSync } from "fs";
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
// `--bureau` is canonical, `--team` is a deprecated alias kept for 90 days.
const bureauIdx = remaining.findIndex((a) => a === "--bureau");
const teamIdx = remaining.findIndex((a) => a === "--team");
if (bureauIdx === -1 && teamIdx !== -1) {
  console.warn("[deprecation] --team is deprecated; use --bureau. The old flag will keep working for 90 days.");
}
const bureauFlagIdx = bureauIdx !== -1 ? bureauIdx : teamIdx;
const bureau = bureauFlagIdx !== -1 ? remaining[bureauFlagIdx + 1] : null;

if (!bureau) {
  console.error("Usage: bun run agents [subcommand] --bureau <name>");
  console.error("Subcommands: setup, start, stop, restart, status, logs, uninstall");
  console.error("Example: bun run agents setup --bureau mybureau");
  process.exit(1);
}

if (!/^[a-z0-9-]+$/.test(bureau)) {
  console.error(`Invalid bureau name: "${bureau}". Only lowercase letters, numbers, and hyphens allowed.`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// No subcommand → existing launcher behavior
// ---------------------------------------------------------------------------

if (!subcommand) {
  // No subcommand — route directly to launcher.ts. process.argv still contains
  // the original args (including --bureau or the legacy --team), which
  // launcher.ts parses itself.
  const launcherPath = resolve(import.meta.dir, "lib", "launcher.ts");
  await import(launcherPath);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Interactive helpers
// ---------------------------------------------------------------------------

async function readSecret(promptText: string): Promise<string> {
  process.stderr.write(promptText);

  if (!process.stdin.isTTY) {
    // Non-interactive (pipe/redirect) — read a line synchronously
    const buf = Buffer.alloc(1024);
    const n = readSync(process.stdin.fd, buf, 0, buf.length, null);
    return buf.slice(0, n).toString().trim();
  }

  process.stdin.setRawMode(true);
  let result = "";
  const buf = Buffer.alloc(1);

  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const n = readSync(process.stdin.fd, buf, 0, 1, null);
      if (n === 0) break;
      const charCode = buf[0];
      if (charCode === 13 || charCode === 10) {
        // Enter key
        process.stderr.write("\n");
        break;
      } else if (charCode === 3) {
        // Ctrl+C
        process.stderr.write("\n");
        process.exit(1);
      } else if (charCode === 127) {
        // Backspace
        result = result.slice(0, -1);
      } else if (charCode >= 32) {
        // Printable character
        result += String.fromCharCode(charCode);
      }
    }
  } finally {
    process.stdin.setRawMode(false);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Setup command
// ---------------------------------------------------------------------------

async function runSetup(bureau: string): Promise<void> {
  const BASE_URL = process.env.HIVE_API_URL || "http://localhost:3000";
  const projectRoot = resolve(import.meta.dir, "..");

  // Check existing config
  if (configExists(bureau)) {
    const answer = prompt(`~/.hive/${bureau}/config.json already exists. Overwrite? (y/N) `) ?? "n";
    if (answer.toLowerCase() !== "y") {
      console.log("Aborted.");
      process.exit(0);
    }
  }

  // Collect credentials
  console.log(`\nSetting up bureau "${bureau}"...\n`);

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

  // Login — validate credentials before writing anything to disk
  const login = await apiPost("/api/builders/login", { email, password });
  if (!login.ok) {
    console.error(`\nLogin failed: ${JSON.stringify(login.data)}`);
    console.error("Check email/password and make sure the server is running.");
    process.exit(1);
  }
  const builderToken = login.data.token as string;
  console.log(`✓ Builder authenticated`);

  // Save credentials only after confirmed valid login
  // SECURITY: never store the password — only the JWT token
  const config: HiveConfig = { email, builder_token: builderToken, anthropic_api_key };
  writeConfig(bureau, config);
  console.log(`✓ Credentials saved to ~/.hive/${bureau}/config.json`);

  // Load bureau config (the directory is still called agents/teams/ for
  // path stability during the 90-day deprecation window).
  const bureauPath = resolve(import.meta.dir, "teams", `${bureau}.ts`);
  if (!existsSync(bureauPath)) {
    console.error(`Bureau config not found: ${bureauPath}`);
    console.error(`Create it by copying agents/teams/_template.ts`);
    process.exit(1);
  }
  const bureauModule = await import(bureauPath);
  const bureauConfig = bureauModule.default;

  // Register agents
  const agentKeys: Record<string, string> = {};
  let registered = 0;
  for (const p of bureauConfig.agents) {
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
    const existing = readKeys(bureau);
    if (!existing || Object.keys(existing.agents).length === 0) {
      console.error("No cached keys found. Delete agents via /dashboard and re-run setup.");
      process.exit(1);
    }
    console.log(`✓ Reusing ${Object.keys(existing.agents).length} existing key(s) from ~/.hive/${bureau}/keys.json`);
    await installAndFinish(bureau, existing, projectRoot);
    return;
  }

  const failedCount = bureauConfig.agents.filter(
    (p: { name: string }) => !agentKeys[p.name]
  ).length;

  if (failedCount > 0) {
    const failedNames = bureauConfig.agents
      .filter((p: { name: string }) => !agentKeys[p.name])
      .map((p: { name: string }) => p.name)
      .join(", ");
    console.warn(`\n⚠ ${failedCount} agent(s) not registered: ${failedNames}`);
    console.warn(`  (409 = already exists, delete via /dashboard to re-register)`);
  }

  const keys: HiveKeys = { builder_token: builderToken, agents: agentKeys };
  writeKeys(bureau, keys);
  console.log(`✓ ${registered} agent key(s) saved to ~/.hive/${bureau}/keys.json`);

  await installAndFinish(bureau, keys, projectRoot);
}

async function installAndFinish(bureau: string, _keys: HiveKeys, projectRoot: string): Promise<void> {
  const bunPath = process.execPath;

  try {
    // `installService` takes a `team` field (macOS plist label stable across
    // the deprecation window). We keep the field name and pass the bureau
    // value — renaming the plist label would break existing user services.
    await installService({ team: bureau, bunPath, projectRoot });
  } catch (err) {
    console.error(`\nFailed to install service: ${err instanceof Error ? err.message : String(err)}`);
    console.error(`You can try manually running: launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/sh.hive.agents.${bureau}.plist`);
    process.exit(1);
  }

  console.log(`\n✓ Service installed: sh.hive.agents.${bureau}`);
  console.log(`✓ Logs: ~/Library/Logs/hive/${bureau}.log`);
  console.log(`\nAgents are running and will auto-start at login.`);
  console.log(`Run 'bun run agents status --bureau ${bureau}' to verify.`);
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

switch (subcommand) {
  case "setup":
    await runSetup(bureau);
    break;
  case "start":
    await startService(bureau);
    console.log(`[hive] Started sh.hive.agents.${bureau}`);
    break;
  case "stop":
    await stopService(bureau);
    console.log(`[hive] Stopped sh.hive.agents.${bureau}`);
    break;
  case "restart":
    await restartService(bureau);
    console.log(`[hive] Restarted sh.hive.agents.${bureau}`);
    break;
  case "status":
    await statusService(bureau);
    break;
  case "logs":
    await logsService(bureau);
    break;
  case "uninstall":
    await uninstallService(bureau);
    break;
}

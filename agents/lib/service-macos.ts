import { existsSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { homedir } from "os";
import { resolve } from "path";

const HOME = homedir();

function plistPath(team: string): string {
  return resolve(HOME, "Library", "LaunchAgents", `sh.hive.agents.${team}.plist`);
}

function logDir(): string {
  return resolve(HOME, "Library", "Logs", "hive");
}

function logPath(team: string): string {
  return resolve(logDir(), `${team}.log`);
}

export interface PlistOptions {
  team: string;
  bunPath: string;
  projectRoot: string;
}

export function generatePlist({ team, bunPath, projectRoot }: PlistOptions): string {
  if (!/^[a-z0-9-]+$/.test(team)) {
    throw new Error(`Invalid team name: "${team}". Only lowercase letters, numbers, and hyphens allowed.`);
  }
  const label = `sh.hive.agents.${team}`;
  const log = logPath(team);
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>

  <key>ProgramArguments</key>
  <array>
    <string>${bunPath}</string>
    <string>agents/cli.ts</string>
    <string>--team</string>
    <string>${team}</string>
  </array>

  <key>WorkingDirectory</key>
  <string>${projectRoot}</string>

  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key>
    <string>${HOME}</string>
  </dict>

  <key>RunAtLoad</key>
  <true/>

  <key>KeepAlive</key>
  <true/>

  <key>StandardOutPath</key>
  <string>${log}</string>

  <key>StandardErrorPath</key>
  <string>${log}</string>
</dict>
</plist>
`;
}

function getUid(): string {
  if (typeof process.getuid === "function") {
    return String(process.getuid());
  }
  throw new Error("process.getuid() not available — is this running on macOS/Linux?");
}

async function launchctl(...args: string[]): Promise<{ ok: boolean; output: string }> {
  const proc = Bun.spawn(["launchctl", ...args], { stdout: "pipe", stderr: "pipe" });
  await proc.exited;
  const out = await new Response(proc.stdout).text();
  const err = await new Response(proc.stderr).text();
  return { ok: proc.exitCode === 0, output: out + err };
}

function requirePlist(team: string): string {
  const p = plistPath(team);
  if (!existsSync(p)) {
    throw new Error(`Service not installed. Run: bun run agents setup --team ${team}`);
  }
  return p;
}

export async function installService(opts: PlistOptions): Promise<void> {
  const entryPoint = resolve(opts.projectRoot, "agents", "cli.ts");
  if (!existsSync(entryPoint)) {
    throw new Error(`agents/cli.ts not found in ${opts.projectRoot}. Make sure you are running from the project root.`);
  }
  mkdirSync(logDir(), { recursive: true });
  const plist = plistPath(opts.team);
  writeFileSync(plist, generatePlist(opts));
  const uid = getUid();
  const result = await launchctl("bootstrap", `gui/${uid}`, plist);
  if (!result.ok && !result.output.includes("already bootstrapped")) {
    throw new Error(`launchctl bootstrap failed:\n${result.output}`);
  }
}

export async function startService(team: string): Promise<void> {
  const plist = requirePlist(team);
  const uid = getUid();
  const result = await launchctl("bootstrap", `gui/${uid}`, plist);
  if (!result.ok && !result.output.includes("already bootstrapped")) {
    throw new Error(`launchctl bootstrap failed:\n${result.output}`);
  }
}

export async function stopService(team: string): Promise<void> {
  const plist = requirePlist(team);
  const uid = getUid();
  const result = await launchctl("bootout", `gui/${uid}`, plist);
  // Already stopped — error strings vary across macOS versions
  const alreadyStopped =
    result.output.includes("No such process") ||
    result.output.includes("Could not find") ||
    result.output.includes("3: No such process");
  if (!result.ok && !alreadyStopped) {
    throw new Error(`launchctl bootout failed:\n${result.output}`);
  }
}

export async function restartService(team: string): Promise<void> {
  // Two-step bootout + bootstrap (not kickstart -k) because stopService uses bootout,
  // which fully unloads the job from launchd. After bootout, kickstart would fail
  // with "service not found". Bootstrap re-registers the plist and starts the service.
  await stopService(team);
  await startService(team);
}

export async function statusService(team: string): Promise<void> {
  const uid = getUid();
  const label = `sh.hive.agents.${team}`;
  const result = await launchctl("print", `gui/${uid}/${label}`);
  if (!result.ok) {
    console.log(`[hive] Service not running (${label})`);
    console.log(`       Run: bun run agents start --team ${team}`);
    return;
  }
  console.log(result.output);
}

export async function logsService(team: string): Promise<void> {
  const log = logPath(team);
  if (!existsSync(log)) {
    console.log(`[hive] No logs yet at ${log}`);
    console.log(`       Run: bun run agents start --team ${team}`);
    return;
  }
  const proc = Bun.spawn(["tail", "-f", log], { stdout: "inherit", stderr: "inherit" });
  await proc.exited;
}

export async function uninstallService(team: string): Promise<void> {
  const plist = requirePlist(team);
  const uid = getUid();
  const bootoutResult = await launchctl("bootout", `gui/${uid}`, plist);
  if (!bootoutResult.ok) {
    console.warn(`[hive] Warning: launchctl bootout exited non-zero: ${bootoutResult.output.trim()}`);
    console.warn(`       The plist will still be removed.`);
  }
  rmSync(plist);
  console.log(`[hive] Service uninstalled.`);
  console.log(`       Credentials preserved at ~/.hive/${team}/`);
  console.log(`       Delete manually if no longer needed.`);
}

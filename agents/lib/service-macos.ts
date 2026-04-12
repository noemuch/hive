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

async function getUid(): Promise<string> {
  const proc = Bun.spawn(["id", "-u"], { stdout: "pipe" });
  await proc.exited;
  return (await new Response(proc.stdout).text()).trim();
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
  mkdirSync(logDir(), { recursive: true });
  const plist = plistPath(opts.team);
  writeFileSync(plist, generatePlist(opts));
  const uid = await getUid();
  const result = await launchctl("bootstrap", `gui/${uid}`, plist);
  if (!result.ok && !result.output.includes("already bootstrapped")) {
    throw new Error(`launchctl bootstrap failed:\n${result.output}`);
  }
}

export async function startService(team: string): Promise<void> {
  const plist = requirePlist(team);
  const uid = await getUid();
  const result = await launchctl("bootstrap", `gui/${uid}`, plist);
  if (!result.ok && !result.output.includes("already bootstrapped")) {
    throw new Error(`launchctl bootstrap failed:\n${result.output}`);
  }
}

export async function stopService(team: string): Promise<void> {
  const plist = requirePlist(team);
  const uid = await getUid();
  const result = await launchctl("bootout", `gui/${uid}`, plist);
  if (!result.ok && !result.output.includes("No such process")) {
    throw new Error(`launchctl bootout failed:\n${result.output}`);
  }
}

export async function restartService(team: string): Promise<void> {
  await stopService(team);
  await startService(team);
}

export async function statusService(team: string): Promise<void> {
  const uid = await getUid();
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
  const uid = await getUid();
  await launchctl("bootout", `gui/${uid}`, plist);
  rmSync(plist);
  console.log(`[hive] Service uninstalled.`);
  console.log(`       Credentials preserved at ~/.hive/${team}/`);
  console.log(`       Delete manually if no longer needed.`);
}

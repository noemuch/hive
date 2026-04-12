import { existsSync, mkdirSync, writeFileSync, readFileSync, chmodSync, renameSync, rmSync } from "fs";
import { homedir, tmpdir } from "os";
import { resolve } from "path";
import { mkdtempSync } from "fs";

export interface HiveConfig {
  email: string;
  password: string;
  anthropic_api_key: string;
}

export interface HiveKeys {
  builder_token: string;
  agents: Record<string, string>;
}

function hiveDir(team: string): string {
  return resolve(homedir(), ".hive", team);
}

function configPath(team: string): string {
  return resolve(hiveDir(team), "config.json");
}

function keysPath(team: string): string {
  return resolve(hiveDir(team), "keys.json");
}

export function configExists(team: string): boolean {
  return existsSync(configPath(team));
}

export function readConfig(team: string): HiveConfig | null {
  const p = configPath(team);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf-8")) as HiveConfig;
  } catch {
    return null;
  }
}

export function writeConfig(team: string, config: HiveConfig): void {
  const dir = hiveDir(team);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const p = configPath(team);
  const tmpDir = mkdtempSync(resolve(tmpdir(), "hive-"));
  try {
    const tmpFile = resolve(tmpDir, "tmp.json");
    writeFileSync(tmpFile, JSON.stringify(config, null, 2) + "\n");
    chmodSync(tmpFile, 0o600);
    renameSync(tmpFile, p);
  } finally {
    // Clean up temp dir (empty after rename, or still has file if rename failed)
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

export function readKeys(team: string): HiveKeys | null {
  const p = keysPath(team);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf-8")) as HiveKeys;
  } catch {
    return null;
  }
}

export function writeKeys(team: string, keys: HiveKeys): void {
  const dir = hiveDir(team);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const p = keysPath(team);
  const tmpDir = mkdtempSync(resolve(tmpdir(), "hive-"));
  try {
    const tmpFile = resolve(tmpDir, "tmp.json");
    writeFileSync(tmpFile, JSON.stringify(keys, null, 2) + "\n");
    chmodSync(tmpFile, 0o600);
    renameSync(tmpFile, p);
  } finally {
    // Clean up temp dir (empty after rename, or still has file if rename failed)
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

export function migrateIfNeeded(team: string, projectRoot: string): void {
  const oldPath = resolve(projectRoot, "agents", "teams", `.keys-${team}.json`);
  const newPath = keysPath(team);
  if (existsSync(oldPath) && !existsSync(newPath)) {
    const dir = hiveDir(team);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    renameSync(oldPath, newPath);
    chmodSync(newPath, 0o600);
    console.log(`[hive] Migrated keys to ~/.hive/${team}/keys.json`);
  }
}

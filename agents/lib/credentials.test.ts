import { describe, it, expect, afterEach } from "bun:test";
import { existsSync, rmSync, statSync, mkdirSync } from "fs";
import { homedir } from "os";
import { resolve } from "path";

// Use a test-specific team name to avoid touching real ~/.hive/
const TEST_TEAM = "test-credentials-" + Date.now();
const HIVE_DIR = resolve(homedir(), ".hive", TEST_TEAM);

// Import after defining TEST_TEAM so module uses homedir() at call time
import {
  configExists,
  readConfig,
  writeConfig,
  readKeys,
  writeKeys,
  migrateIfNeeded,
  type HiveConfig,
  type HiveKeys,
} from "./credentials";

const sampleConfig: HiveConfig = {
  email: "test@example.com",
  builder_token: "jwt-test-token",
  anthropic_api_key: "sk-ant-test",
};

const sampleKeys: HiveKeys = {
  builder_token: "jwt-abc",
  agents: { Nova: "hive-key-nova", Arke: "hive-key-arke" },
};

afterEach(() => {
  // Clean up test dir
  if (existsSync(HIVE_DIR)) rmSync(HIVE_DIR, { recursive: true });
});

describe("credentials", () => {
  describe("configExists", () => {
    it("returns false when config does not exist", () => {
      expect(configExists(TEST_TEAM)).toBe(false);
    });

    it("returns true after writeConfig", () => {
      writeConfig(TEST_TEAM, sampleConfig);
      expect(configExists(TEST_TEAM)).toBe(true);
    });
  });

  describe("writeConfig / readConfig", () => {
    it("round-trips config correctly", () => {
      writeConfig(TEST_TEAM, sampleConfig);
      const result = readConfig(TEST_TEAM);
      expect(result).toEqual(sampleConfig);
    });

    it("sets chmod 600 on config file", () => {
      writeConfig(TEST_TEAM, sampleConfig);
      const configFile = resolve(HIVE_DIR, "config.json");
      const mode = statSync(configFile).mode & 0o777;
      expect(mode).toBe(0o600);
    });

    it("sets mode 700 on ~/.hive/{team}/ directory", () => {
      writeConfig(TEST_TEAM, sampleConfig);
      const dirMode = statSync(HIVE_DIR).mode & 0o777;
      expect(dirMode).toBe(0o700);
    });

    it("readConfig returns null when file absent", () => {
      expect(readConfig(TEST_TEAM)).toBeNull();
    });
  });

  describe("writeKeys / readKeys", () => {
    it("round-trips keys correctly", () => {
      writeKeys(TEST_TEAM, sampleKeys);
      const result = readKeys(TEST_TEAM);
      expect(result).toEqual(sampleKeys);
    });

    it("sets chmod 600 on keys file", () => {
      writeKeys(TEST_TEAM, sampleKeys);
      const keysFile = resolve(HIVE_DIR, "keys.json");
      const mode = statSync(keysFile).mode & 0o777;
      expect(mode).toBe(0o600);
    });

    it("readKeys returns null when file absent", () => {
      expect(readKeys(TEST_TEAM)).toBeNull();
    });

    it("sets mode 700 on ~/.hive/{team}/ directory", () => {
      writeKeys(TEST_TEAM, sampleKeys);
      const dirMode = statSync(HIVE_DIR).mode & 0o777;
      expect(dirMode).toBe(0o700);
    });
  });

  describe("migrateIfNeeded", () => {
    it("does nothing when no old file exists", () => {
      migrateIfNeeded(TEST_TEAM, "/tmp/nonexistent-project");
      expect(existsSync(HIVE_DIR)).toBe(false);
    });

    it("moves old .keys file to ~/.hive/{team}/keys.json", async () => {
      // Set up fake project root with old keys file
      const fakeRoot = resolve("/tmp", "hive-migrate-test-" + Date.now());
      const oldDir = resolve(fakeRoot, "agents", "teams");
      mkdirSync(oldDir, { recursive: true });
      const oldPath = resolve(oldDir, `.keys-${TEST_TEAM}.json`);
      await Bun.write(oldPath, JSON.stringify(sampleKeys, null, 2));

      migrateIfNeeded(TEST_TEAM, fakeRoot);

      // Old file gone
      expect(existsSync(oldPath)).toBe(false);
      // New file exists and has correct content
      const result = readKeys(TEST_TEAM);
      expect(result).toEqual(sampleKeys);
      // New file is chmod 600
      const keysFile = resolve(HIVE_DIR, "keys.json");
      const mode = statSync(keysFile).mode & 0o777;
      expect(mode).toBe(0o600);

      // Cleanup
      rmSync(fakeRoot, { recursive: true });
    });

    it("does not overwrite existing keys.json", async () => {
      // Write existing keys
      writeKeys(TEST_TEAM, sampleKeys);

      // Set up old file with different content
      const fakeRoot = resolve("/tmp", "hive-migrate-test2-" + Date.now());
      const oldDir = resolve(fakeRoot, "agents", "teams");
      mkdirSync(oldDir, { recursive: true });
      const oldPath = resolve(oldDir, `.keys-${TEST_TEAM}.json`);
      const oldKeys: HiveKeys = { builder_token: "old-token", agents: {} };
      await Bun.write(oldPath, JSON.stringify(oldKeys, null, 2));

      migrateIfNeeded(TEST_TEAM, fakeRoot);

      // Existing keys.json untouched
      const result = readKeys(TEST_TEAM);
      expect(result).toEqual(sampleKeys);

      rmSync(fakeRoot, { recursive: true });
    });
  });
});

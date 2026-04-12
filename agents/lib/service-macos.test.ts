import { describe, it, expect } from "bun:test";
import { homedir } from "os";
import { generatePlist } from "./service-macos";

const opts = {
  team: "lyse",
  bunPath: "/home/user/.bun/bin/bun",
  projectRoot: "/home/user/hive",
};

describe("generatePlist", () => {
  it("includes the correct label", () => {
    const plist = generatePlist(opts);
    expect(plist).toContain("<string>sh.hive.agents.lyse</string>");
  });

  it("uses the absolute bun path", () => {
    const plist = generatePlist(opts);
    expect(plist).toContain("<string>/home/user/.bun/bin/bun</string>");
  });

  it("includes the team name in ProgramArguments", () => {
    const plist = generatePlist(opts);
    expect(plist).toContain("<string>lyse</string>");
  });

  it("sets WorkingDirectory to project root", () => {
    const plist = generatePlist(opts);
    expect(plist).toContain("<string>/home/user/hive</string>");
  });

  it("sets RunAtLoad and KeepAlive to true", () => {
    const plist = generatePlist(opts);
    const runAtLoadIdx = plist.indexOf("RunAtLoad");
    const keepAliveIdx = plist.indexOf("KeepAlive");
    expect(runAtLoadIdx).toBeGreaterThan(0);
    expect(keepAliveIdx).toBeGreaterThan(0);
    const trueCount = (plist.match(/<true\/>/g) ?? []).length;
    expect(trueCount).toBeGreaterThanOrEqual(2);
  });

  it("sets stdout and stderr log paths", () => {
    const plist = generatePlist(opts);
    expect(plist).toContain("StandardOutPath");
    expect(plist).toContain("StandardErrorPath");
    expect(plist).toContain("lyse.log");
  });

  it("injects HOME into EnvironmentVariables", () => {
    const plist = generatePlist(opts);
    expect(plist).toContain("EnvironmentVariables");
    expect(plist).toContain("<key>HOME</key>");
    expect(plist).toContain(`<string>${homedir()}</string>`);
  });

  it("is valid XML (opens and closes plist tags)", () => {
    const plist = generatePlist(opts);
    expect(plist).toContain("<?xml");
    expect(plist).toContain("<plist");
    expect(plist).toContain("</plist>");
  });
});

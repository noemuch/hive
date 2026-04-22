import { describe, it, expect } from "bun:test";
import { anonymizeContent, relativeTime } from "../lib/anonymizer";
import type { NameMaps } from "../lib/db";

function makeNames(
  agents: [string, string][] = [],
  bureaux: [string, string][] = [],
  builders: [string, string][] = [],
  channels: [string, string][] = [],
): NameMaps {
  return {
    agentNames: new Map(agents),
    builderNames: new Map(builders),
    bureauNames: new Map(bureaux),
    channelNames: new Map(channels),
  };
}

describe("anonymizeContent — UUIDs", () => {
  it("replaces a UUID with ARTIFACT_REF_1", () => {
    const { content } = anonymizeContent(
      "See 550e8400-e29b-41d4-a716-446655440000 for context",
      makeNames(),
    );
    expect(content).toContain("[ARTIFACT_REF_1]");
    expect(content).not.toContain("550e8400");
  });

  it("maps the same UUID to the same ref token", () => {
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    const { content } = anonymizeContent(`${uuid} and ${uuid}`, makeNames());
    expect(content.match(/\[ARTIFACT_REF_1\]/g)?.length).toBe(2);
  });

  it("assigns different ref tokens to different UUIDs", () => {
    const { content } = anonymizeContent(
      "A: 550e8400-e29b-41d4-a716-446655440000, B: 660e8400-e29b-41d4-a716-446655440000",
      makeNames(),
    );
    expect(content).toContain("[ARTIFACT_REF_1]");
    expect(content).toContain("[ARTIFACT_REF_2]");
  });
});

describe("anonymizeContent — agent names", () => {
  it("replaces agent name with AGENT_A", () => {
    const { content } = anonymizeContent(
      "AlphaBot reviewed the spec",
      makeNames([["id-1", "AlphaBot"]]),
    );
    expect(content).toContain("[AGENT_A]");
    expect(content).not.toContain("AlphaBot");
  });
});

describe("anonymizeContent — bureau names", () => {
  it("replaces bureau name with BUREAU_1", () => {
    const { content } = anonymizeContent(
      "Engineering submitted the PR",
      makeNames([], [["id-1", "Engineering"]]),
    );
    expect(content).toContain("[BUREAU_1]");
    expect(content).not.toContain("Engineering");
  });
});

describe("anonymizeContent — timestamps", () => {
  it("replaces ISO timestamp with relative form", () => {
    const now = new Date("2026-04-11T12:00:00Z");
    const { content } = anonymizeContent(
      "Created at 2026-04-10T12:00:00Z",
      makeNames(),
      now,
    );
    expect(content).toContain("yesterday");
    expect(content).not.toContain("2026-04-10");
  });
});

describe("anonymizeContent — no-op cases", () => {
  it("preserves content when no names or UUIDs are present", () => {
    const input = "This artifact discusses architecture patterns.";
    const { content } = anonymizeContent(input, makeNames());
    expect(content).toBe(input);
  });
});

describe("relativeTime", () => {
  const now = 1_000_000_000;

  it("returns 'just now' for < 60 seconds", () => {
    expect(relativeTime(now - 30_000, now)).toBe("just now");
  });

  it("returns 'N minutes ago' for < 1 hour", () => {
    expect(relativeTime(now - 30 * 60 * 1_000, now)).toBe("30 minutes ago");
  });

  it("returns 'yesterday' for ~24-25 hours ago", () => {
    expect(relativeTime(now - 25 * 60 * 60 * 1_000, now)).toBe("yesterday");
  });

  it("returns 'N days ago' for 3 days", () => {
    expect(relativeTime(now - 3 * 24 * 60 * 60 * 1_000, now)).toBe(
      "3 days ago",
    );
  });
});

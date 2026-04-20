import { describe, it, expect, mock } from "bun:test";
import { handleAgentBadges } from "./agent-badges";

// Mock pool: single query returns the merged agent + stats row.
// Tests drive inputs via this row — the handler derives all badges from it.
type FakeRow = {
  score_state_mu: string | number | null;
  deployed_at: Date | string;
  messages_sent: number;
  artifacts_created: number;
  total_ranked: number;
  agents_ahead: number;
};

function makePool(row: FakeRow | null) {
  return {
    query: mock(async (_sql: string, _params: unknown[]) => ({
      rows: row === null ? [] : [row],
    })),
  };
}

const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);
const VALID_UUID = "11111111-1111-1111-1111-111111111111";

describe("handleAgentBadges", () => {
  it("returns 404 for invalid UUID", async () => {
    const pool = makePool(null);
    const res = await handleAgentBadges("not-a-uuid", pool as any);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("not_found");
  });

  it("returns 404 when agent does not exist", async () => {
    const pool = makePool(null);
    const res = await handleAgentBadges(VALID_UUID, pool as any);
    expect(res.status).toBe(404);
  });

  it("returns empty badges array for a new unqualified agent", async () => {
    const pool = makePool({
      score_state_mu: null,
      deployed_at: daysAgo(1),
      messages_sent: 0,
      artifacts_created: 0,
      total_ranked: 0,
      agents_ahead: 0,
    });
    const res = await handleAgentBadges(VALID_UUID, pool as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.badges).toEqual([]);
  });

  it("sets Cache-Control: public, max-age=3600", async () => {
    const pool = makePool({
      score_state_mu: null,
      deployed_at: daysAgo(0),
      messages_sent: 0,
      artifacts_created: 0,
      total_ranked: 0,
      agents_ahead: 0,
    });
    const res = await handleAgentBadges(VALID_UUID, pool as any);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=3600");
  });

  it("awards high-performer when score_state_mu >= 7.0", async () => {
    const pool = makePool({
      score_state_mu: "7.0",
      deployed_at: daysAgo(1),
      messages_sent: 0,
      artifacts_created: 0,
      total_ranked: 100,
      agents_ahead: 50,
    });
    const body = await (await handleAgentBadges(VALID_UUID, pool as any)).json();
    const types = body.badges.map((b: any) => b.badge_type);
    expect(types).toContain("high-performer");
    const hp = body.badges.find((b: any) => b.badge_type === "high-performer");
    expect(hp.description).toBe("HEAR quality score at or above 7.0");
    expect(hp.awarded_at).toBeNull();
  });

  it("does NOT award high-performer when score_state_mu is below 7.0", async () => {
    const pool = makePool({
      score_state_mu: "6.9",
      deployed_at: daysAgo(1),
      messages_sent: 0,
      artifacts_created: 0,
      total_ranked: 10,
      agents_ahead: 0,
    });
    const body = await (await handleAgentBadges(VALID_UUID, pool as any)).json();
    const types = body.badges.map((b: any) => b.badge_type);
    expect(types).not.toContain("high-performer");
  });

  it("awards top-10 when rank is in the top 10 percent", async () => {
    // total_ranked=100, agents_ahead=5 => rank=6 => top 10% threshold = ceil(100*0.1)=10 => awarded
    const pool = makePool({
      score_state_mu: "8.0",
      deployed_at: daysAgo(1),
      messages_sent: 0,
      artifacts_created: 0,
      total_ranked: 100,
      agents_ahead: 5,
    });
    const body = await (await handleAgentBadges(VALID_UUID, pool as any)).json();
    const types = body.badges.map((b: any) => b.badge_type);
    expect(types).toContain("top-10");
  });

  it("does NOT award top-10 when rank is outside the top 10 percent", async () => {
    // total_ranked=100, agents_ahead=20 => rank=21 > 10
    const pool = makePool({
      score_state_mu: "5.0",
      deployed_at: daysAgo(1),
      messages_sent: 0,
      artifacts_created: 0,
      total_ranked: 100,
      agents_ahead: 20,
    });
    const body = await (await handleAgentBadges(VALID_UUID, pool as any)).json();
    const types = body.badges.map((b: any) => b.badge_type);
    expect(types).not.toContain("top-10");
  });

  it("does NOT award top-10 when agent has no HEAR score", async () => {
    const pool = makePool({
      score_state_mu: null,
      deployed_at: daysAgo(1),
      messages_sent: 0,
      artifacts_created: 0,
      total_ranked: 100,
      agents_ahead: 0,
    });
    const body = await (await handleAgentBadges(VALID_UUID, pool as any)).json();
    const types = body.badges.map((b: any) => b.badge_type);
    expect(types).not.toContain("top-10");
  });

  it("awards 30-day-proven when deployed_at is 30+ days ago", async () => {
    const pool = makePool({
      score_state_mu: null,
      deployed_at: daysAgo(45),
      messages_sent: 0,
      artifacts_created: 0,
      total_ranked: 0,
      agents_ahead: 0,
    });
    const body = await (await handleAgentBadges(VALID_UUID, pool as any)).json();
    const types = body.badges.map((b: any) => b.badge_type);
    expect(types).toContain("30-day-proven");
  });

  it("awards prolific when messages_sent >= 500", async () => {
    const pool = makePool({
      score_state_mu: null,
      deployed_at: daysAgo(1),
      messages_sent: 500,
      artifacts_created: 0,
      total_ranked: 0,
      agents_ahead: 0,
    });
    const body = await (await handleAgentBadges(VALID_UUID, pool as any)).json();
    const types = body.badges.map((b: any) => b.badge_type);
    expect(types).toContain("prolific");
  });

  it("awards maker when artifacts_created >= 5", async () => {
    const pool = makePool({
      score_state_mu: null,
      deployed_at: daysAgo(1),
      messages_sent: 0,
      artifacts_created: 5,
      total_ranked: 0,
      agents_ahead: 0,
    });
    const body = await (await handleAgentBadges(VALID_UUID, pool as any)).json();
    const types = body.badges.map((b: any) => b.badge_type);
    expect(types).toContain("maker");
  });

  it("awards all 5 badges for a fully-qualified top-tier agent", async () => {
    const pool = makePool({
      score_state_mu: "8.5",
      deployed_at: daysAgo(60),
      messages_sent: 1000,
      artifacts_created: 20,
      total_ranked: 50,
      agents_ahead: 1,
    });
    const body = await (await handleAgentBadges(VALID_UUID, pool as any)).json();
    const types = body.badges.map((b: any) => b.badge_type).sort();
    expect(types).toEqual(
      ["30-day-proven", "high-performer", "maker", "prolific", "top-10"]
    );
    // All entries must have the expected shape
    for (const b of body.badges) {
      expect(typeof b.badge_type).toBe("string");
      expect(typeof b.description).toBe("string");
      expect(b.awarded_at).toBeNull();
    }
  });
});

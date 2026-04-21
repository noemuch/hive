import { describe, it, expect, mock } from "bun:test";
import { handleGetReviews, handlePostReview } from "./agent-reviews";
import { createBuilderToken } from "../auth/index";

const OWNER_ID = "11111111-1111-1111-1111-111111111111";
const REVIEWER_ID = "22222222-2222-2222-2222-222222222222";
const OUTSIDER_ID = "33333333-3333-3333-3333-333333333333";
const AGENT_ID = "44444444-4444-4444-4444-444444444444";
const REVIEW_ID = "55555555-5555-5555-5555-555555555555";

function tokenFor(builderId: string): string {
  return `Bearer ${createBuilderToken(builderId)}`;
}

type AgentRow = { id: string; builder_id: string };

function makePool(steps: Array<{ rows: unknown[] }>) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  let i = 0;
  const pool = {
    query: mock(async (sql: string, params: unknown[]) => {
      calls.push({ sql, params });
      const step = steps[i++];
      if (!step) throw new Error(`unexpected query #${i}: ${sql.slice(0, 80)}`);
      return step;
    }),
  };
  return { pool, calls };
}

describe("handleGetReviews", () => {
  it("returns 404 for invalid UUID", async () => {
    const { pool } = makePool([]);
    const req = new Request("http://localhost/api/agents/not-a-uuid/reviews");
    const res = await handleGetReviews(req, pool as any, "not-a-uuid");
    expect(res.status).toBe(404);
  });

  it("returns 404 when agent does not exist", async () => {
    const { pool } = makePool([{ rows: [] }]);
    const req = new Request(`http://localhost/api/agents/${AGENT_ID}/reviews`);
    const res = await handleGetReviews(req, pool as any, AGENT_ID);
    expect(res.status).toBe(404);
  });

  it("returns reviews with avg_rating and count (anonymous)", async () => {
    const { pool } = makePool([
      { rows: [{ id: AGENT_ID, builder_id: OWNER_ID } as AgentRow] },
      {
        rows: [
          {
            id: REVIEW_ID,
            rating: 5,
            content: "great agent",
            created_at: new Date("2026-04-20T10:00:00Z"),
            reviewer_builder_id: REVIEWER_ID,
            reviewer_display_name: "Alice",
          },
          {
            id: "66666666-6666-6666-6666-666666666666",
            rating: 3,
            content: null,
            created_at: new Date("2026-04-19T10:00:00Z"),
            reviewer_builder_id: OUTSIDER_ID,
            reviewer_display_name: "Bob",
          },
        ],
      },
      { rows: [{ count: 2, avg: "4.0" }] },
    ]);
    const req = new Request(`http://localhost/api/agents/${AGENT_ID}/reviews`);
    const res = await handleGetReviews(req, pool as any, AGENT_ID);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(2);
    expect(body.avg_rating).toBe(4.0);
    expect(body.reviews).toHaveLength(2);
    expect(body.reviews[0].rating).toBe(5);
    expect(body.reviews[0].reviewer.display_name).toBe("Alice");
    expect(body.viewer).toBeUndefined();
  });

  it("attaches viewer block when Authorization is present (reviewer, forked, not reviewed)", async () => {
    const { pool } = makePool([
      { rows: [{ id: AGENT_ID, builder_id: OWNER_ID } as AgentRow] },
      { rows: [] },
      { rows: [{ count: 0, avg: null }] },
      // viewer-eligibility queries: existing review? forked?
      { rows: [] },
      { rows: [{ exists: true }] },
    ]);
    const req = new Request(`http://localhost/api/agents/${AGENT_ID}/reviews`, {
      headers: { Authorization: tokenFor(REVIEWER_ID) },
    });
    const res = await handleGetReviews(req, pool as any, AGENT_ID);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.viewer).toEqual({
      is_owner: false,
      has_reviewed: false,
      can_review: true,
    });
  });

  it("viewer.is_owner=true disables can_review for the owner", async () => {
    const { pool } = makePool([
      { rows: [{ id: AGENT_ID, builder_id: OWNER_ID } as AgentRow] },
      { rows: [] },
      { rows: [{ count: 0, avg: null }] },
    ]);
    const req = new Request(`http://localhost/api/agents/${AGENT_ID}/reviews`, {
      headers: { Authorization: tokenFor(OWNER_ID) },
    });
    const res = await handleGetReviews(req, pool as any, AGENT_ID);
    const body = await res.json();
    expect(body.viewer.is_owner).toBe(true);
    expect(body.viewer.can_review).toBe(false);
  });

  it("viewer.has_reviewed=true when reviewer already posted", async () => {
    const { pool } = makePool([
      { rows: [{ id: AGENT_ID, builder_id: OWNER_ID } as AgentRow] },
      { rows: [] },
      { rows: [{ count: 1, avg: "4.0" }] },
      { rows: [{ id: REVIEW_ID }] },
      { rows: [{ exists: true }] },
    ]);
    const req = new Request(`http://localhost/api/agents/${AGENT_ID}/reviews`, {
      headers: { Authorization: tokenFor(REVIEWER_ID) },
    });
    const res = await handleGetReviews(req, pool as any, AGENT_ID);
    const body = await res.json();
    expect(body.viewer.has_reviewed).toBe(true);
    // already-reviewed builders can still *edit* via upsert — can_review stays true.
    expect(body.viewer.can_review).toBe(true);
  });

  it("viewer.can_review=false when builder has not forked", async () => {
    const { pool } = makePool([
      { rows: [{ id: AGENT_ID, builder_id: OWNER_ID } as AgentRow] },
      { rows: [] },
      { rows: [{ count: 0, avg: null }] },
      { rows: [] },
      { rows: [{ exists: false }] },
    ]);
    const req = new Request(`http://localhost/api/agents/${AGENT_ID}/reviews`, {
      headers: { Authorization: tokenFor(OUTSIDER_ID) },
    });
    const res = await handleGetReviews(req, pool as any, AGENT_ID);
    const body = await res.json();
    expect(body.viewer.can_review).toBe(false);
  });
});

describe("handlePostReview", () => {
  it("returns 401 without Authorization header", async () => {
    const { pool } = makePool([]);
    const req = new Request(`http://localhost/api/agents/${AGENT_ID}/reviews`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rating: 5 }),
    });
    const res = await handlePostReview(req, pool as any, AGENT_ID);
    expect(res.status).toBe(401);
  });

  it("returns 404 when agent does not exist", async () => {
    const { pool } = makePool([{ rows: [] }]);
    const req = new Request(`http://localhost/api/agents/${AGENT_ID}/reviews`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: tokenFor(REVIEWER_ID) },
      body: JSON.stringify({ rating: 5 }),
    });
    const res = await handlePostReview(req, pool as any, AGENT_ID);
    expect(res.status).toBe(404);
  });

  it("returns 403 when caller is the agent owner", async () => {
    const { pool } = makePool([
      { rows: [{ id: AGENT_ID, builder_id: OWNER_ID } as AgentRow] },
    ]);
    const req = new Request(`http://localhost/api/agents/${AGENT_ID}/reviews`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: tokenFor(OWNER_ID) },
      body: JSON.stringify({ rating: 5 }),
    });
    const res = await handlePostReview(req, pool as any, AGENT_ID);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("cannot_review_own");
  });

  it("returns 403 when caller has not forked the agent", async () => {
    const { pool } = makePool([
      { rows: [{ id: AGENT_ID, builder_id: OWNER_ID } as AgentRow] },
      { rows: [{ exists: false }] },
    ]);
    const req = new Request(`http://localhost/api/agents/${AGENT_ID}/reviews`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: tokenFor(OUTSIDER_ID) },
      body: JSON.stringify({ rating: 5 }),
    });
    const res = await handlePostReview(req, pool as any, AGENT_ID);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("not_eligible");
  });

  it("returns 400 when rating is missing or out of range", async () => {
    for (const bad of [null, undefined, 0, 6, "5", 3.5]) {
      const { pool } = makePool([
        { rows: [{ id: AGENT_ID, builder_id: OWNER_ID } as AgentRow] },
        { rows: [{ exists: true }] },
      ]);
      const req = new Request(`http://localhost/api/agents/${AGENT_ID}/reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: tokenFor(REVIEWER_ID) },
        body: JSON.stringify({ rating: bad }),
      });
      const res = await handlePostReview(req, pool as any, AGENT_ID);
      expect(res.status).toBe(400);
    }
  });

  it("returns 400 when content exceeds 2000 chars", async () => {
    const { pool } = makePool([
      { rows: [{ id: AGENT_ID, builder_id: OWNER_ID } as AgentRow] },
      { rows: [{ exists: true }] },
    ]);
    const req = new Request(`http://localhost/api/agents/${AGENT_ID}/reviews`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: tokenFor(REVIEWER_ID) },
      body: JSON.stringify({ rating: 4, content: "x".repeat(2001) }),
    });
    const res = await handlePostReview(req, pool as any, AGENT_ID);
    expect(res.status).toBe(400);
  });

  it("creates a review and returns 201 (first submission)", async () => {
    const now = new Date();
    const { pool, calls } = makePool([
      { rows: [{ id: AGENT_ID, builder_id: OWNER_ID } as AgentRow] },
      { rows: [{ exists: true }] },
      {
        rows: [
          {
            id: REVIEW_ID,
            rating: 5,
            content: "great agent",
            created_at: now,
            updated_at: now,
            updated: false, // postgres: (xmax <> 0) — false = fresh INSERT
          },
        ],
      },
    ]);
    const req = new Request(`http://localhost/api/agents/${AGENT_ID}/reviews`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: tokenFor(REVIEWER_ID) },
      body: JSON.stringify({ rating: 5, content: "great agent" }),
    });
    const res = await handlePostReview(req, pool as any, AGENT_ID);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.review.id).toBe(REVIEW_ID);
    expect(body.review.rating).toBe(5);
    // The last call should be the upsert.
    const upsert = calls[2];
    expect(upsert.sql).toMatch(/INSERT INTO agent_reviews/);
    expect(upsert.sql).toMatch(/ON CONFLICT/);
  });

  it("upserts an existing review and returns 200", async () => {
    const now = new Date();
    const { pool } = makePool([
      { rows: [{ id: AGENT_ID, builder_id: OWNER_ID } as AgentRow] },
      { rows: [{ exists: true }] },
      {
        rows: [
          {
            id: REVIEW_ID,
            rating: 4,
            content: "updated",
            created_at: now,
            updated_at: now,
            updated: true, // postgres: (xmax <> 0) — true = upsert hit conflict
          },
        ],
      },
    ]);
    const req = new Request(`http://localhost/api/agents/${AGENT_ID}/reviews`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: tokenFor(REVIEWER_ID) },
      body: JSON.stringify({ rating: 4, content: "updated" }),
    });
    const res = await handlePostReview(req, pool as any, AGENT_ID);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.review.rating).toBe(4);
    expect(body.review.content).toBe("updated");
  });
});

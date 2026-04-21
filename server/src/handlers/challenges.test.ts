import { describe, it, expect, mock } from "bun:test";
import {
  handleListChallenges,
  handleGetChallenge,
  handleGetCurrentChallenge,
  handleCreateSubmission,
  handleVoteSubmission,
} from "./challenges";
import { createBuilderToken } from "../auth/index";

const OWNER_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_BUILDER_ID = "22222222-2222-2222-2222-222222222222";
const AGENT_ID = "33333333-3333-3333-3333-333333333333";
const ARTIFACT_ID = "44444444-4444-4444-4444-444444444444";
const CHALLENGE_ID = "55555555-5555-5555-5555-555555555555";

const SLUG = "week-1-refactor-node-handler";

function ownerToken(): string { return `Bearer ${createBuilderToken(OWNER_ID)}`; }
function otherToken(): string { return `Bearer ${createBuilderToken(OTHER_BUILDER_ID)}`; }

type Step = { rows: unknown[] } | { reject: { code: string; message?: string } };

function makePool(steps: Step[]) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  let i = 0;
  const pool = {
    query: mock(async (sql: string, params: unknown[]) => {
      calls.push({ sql, params });
      const step = steps[i++];
      if (!step) throw new Error(`unexpected query #${i}: ${sql.slice(0, 60)}`);
      if ("reject" in step) {
        throw Object.assign(new Error(step.reject.message ?? "pg-error"), {
          code: step.reject.code,
        });
      }
      return step;
    }),
  };
  return { pool, calls };
}

describe("handleListChallenges", () => {
  it("returns all challenges ordered by ends_at desc", async () => {
    const { pool, calls } = makePool([
      {
        rows: [
          {
            id: CHALLENGE_ID,
            slug: SLUG,
            title: "Week 1",
            agent_type_filter: ["code_diff"],
            starts_at: new Date(),
            ends_at: new Date(Date.now() + 7 * 86400000),
            status: "active",
            submission_count: 3,
          },
        ],
      },
    ]);
    const res = await handleListChallenges(
      new URL("http://localhost/api/challenges"),
      pool as any
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.challenges).toHaveLength(1);
    expect(body.challenges[0].slug).toBe(SLUG);
    expect(calls[0].sql).toMatch(/ORDER BY/i);
  });

  it("filters by status when provided", async () => {
    const { pool, calls } = makePool([{ rows: [] }]);
    await handleListChallenges(
      new URL("http://localhost/api/challenges?status=completed"),
      pool as any
    );
    expect(calls[0].params).toContain("completed");
  });

  it("rejects invalid status values", async () => {
    const { pool } = makePool([]);
    const res = await handleListChallenges(
      new URL("http://localhost/api/challenges?status=bogus"),
      pool as any
    );
    expect(res.status).toBe(400);
  });
});

describe("handleGetCurrentChallenge", () => {
  it("returns 404 when no active challenge", async () => {
    const { pool } = makePool([{ rows: [] }]);
    const res = await handleGetCurrentChallenge(pool as any);
    expect(res.status).toBe(404);
  });

  it("returns active challenge + submissions", async () => {
    const { pool } = makePool([
      {
        rows: [
          {
            id: CHALLENGE_ID,
            slug: SLUG,
            title: "Week 1",
            prompt: "Refactor...",
            agent_type_filter: ["code_diff"],
            rubric_variant: "code",
            starts_at: new Date(),
            ends_at: new Date(Date.now() + 86400000),
            status: "active",
          },
        ],
      },
      {
        rows: [
          {
            submission_id: "s1",
            agent_id: AGENT_ID,
            agent_name: "alice",
            agent_avatar_seed: "seed",
            artifact_id: ARTIFACT_ID,
            artifact_type: "code_diff",
            artifact_title: "Refactor draft",
            submitted_at: new Date(),
            vote_count: 4,
            score_state_mu: 7.5,
          },
        ],
      },
    ]);
    const res = await handleGetCurrentChallenge(pool as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.challenge.slug).toBe(SLUG);
    expect(body.submissions).toHaveLength(1);
    expect(body.submissions[0].agent_name).toBe("alice");
  });
});

describe("handleGetChallenge", () => {
  it("returns 400 for invalid slug", async () => {
    const { pool } = makePool([]);
    const res = await handleGetChallenge("BAD SLUG WITH SPACES", pool as any);
    expect(res.status).toBe(400);
  });

  it("returns 404 when slug does not exist", async () => {
    const { pool } = makePool([{ rows: [] }]);
    const res = await handleGetChallenge("missing-one", pool as any);
    expect(res.status).toBe(404);
  });

  it("returns challenge + submissions ordered by score+votes", async () => {
    const { pool, calls } = makePool([
      {
        rows: [
          {
            id: CHALLENGE_ID,
            slug: SLUG,
            title: "Week 1",
            prompt: "Refactor...",
            agent_type_filter: ["code_diff"],
            rubric_variant: "code",
            starts_at: new Date(),
            ends_at: new Date(),
            status: "active",
          },
        ],
      },
      { rows: [] },
    ]);
    const res = await handleGetChallenge(SLUG, pool as any);
    expect(res.status).toBe(200);
    expect(calls[1].sql).toMatch(/ORDER BY/i);
  });
});

describe("handleCreateSubmission", () => {
  it("returns 401 without Authorization", async () => {
    const { pool } = makePool([]);
    const req = new Request(
      `http://localhost/api/challenges/${SLUG}/submissions`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent_id: AGENT_ID, artifact_id: ARTIFACT_ID }),
      }
    );
    const res = await handleCreateSubmission(req, pool as any, SLUG);
    expect(res.status).toBe(401);
  });

  it("returns 404 when challenge missing", async () => {
    const { pool } = makePool([{ rows: [] }]);
    const req = new Request(
      `http://localhost/api/challenges/${SLUG}/submissions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: ownerToken(),
        },
        body: JSON.stringify({ agent_id: AGENT_ID, artifact_id: ARTIFACT_ID }),
      }
    );
    const res = await handleCreateSubmission(req, pool as any, SLUG);
    expect(res.status).toBe(404);
  });

  it("returns 400 when challenge is not active", async () => {
    const { pool } = makePool([
      {
        rows: [
          {
            id: CHALLENGE_ID,
            agent_type_filter: ["code_diff"],
            status: "completed",
            starts_at: new Date(Date.now() - 10 * 86400000),
            ends_at: new Date(Date.now() - 86400000),
          },
        ],
      },
    ]);
    const req = new Request(
      `http://localhost/api/challenges/${SLUG}/submissions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: ownerToken(),
        },
        body: JSON.stringify({ agent_id: AGENT_ID, artifact_id: ARTIFACT_ID }),
      }
    );
    const res = await handleCreateSubmission(req, pool as any, SLUG);
    expect(res.status).toBe(400);
  });

  it("returns 403 when builder does not own the agent", async () => {
    const { pool } = makePool([
      {
        rows: [
          {
            id: CHALLENGE_ID,
            agent_type_filter: ["code_diff"],
            status: "active",
            starts_at: new Date(Date.now() - 86400000),
            ends_at: new Date(Date.now() + 86400000),
          },
        ],
      },
      // Agent lookup — returns a different owner
      {
        rows: [
          { id: AGENT_ID, builder_id: OTHER_BUILDER_ID },
        ],
      },
    ]);
    const req = new Request(
      `http://localhost/api/challenges/${SLUG}/submissions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: ownerToken(),
        },
        body: JSON.stringify({ agent_id: AGENT_ID, artifact_id: ARTIFACT_ID }),
      }
    );
    const res = await handleCreateSubmission(req, pool as any, SLUG);
    expect(res.status).toBe(403);
  });

  it("returns 404 when artifact does not belong to the agent", async () => {
    const { pool } = makePool([
      {
        rows: [
          {
            id: CHALLENGE_ID,
            agent_type_filter: ["code_diff"],
            status: "active",
            starts_at: new Date(Date.now() - 86400000),
            ends_at: new Date(Date.now() + 86400000),
          },
        ],
      },
      { rows: [{ id: AGENT_ID, builder_id: OWNER_ID }] },
      // Artifact lookup — empty (not owned by agent)
      { rows: [] },
    ]);
    const req = new Request(
      `http://localhost/api/challenges/${SLUG}/submissions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: ownerToken(),
        },
        body: JSON.stringify({ agent_id: AGENT_ID, artifact_id: ARTIFACT_ID }),
      }
    );
    const res = await handleCreateSubmission(req, pool as any, SLUG);
    expect(res.status).toBe(404);
  });

  it("returns 400 when artifact type is not in the filter", async () => {
    const { pool } = makePool([
      {
        rows: [
          {
            id: CHALLENGE_ID,
            agent_type_filter: ["code_diff"],
            status: "active",
            starts_at: new Date(Date.now() - 86400000),
            ends_at: new Date(Date.now() + 86400000),
          },
        ],
      },
      { rows: [{ id: AGENT_ID, builder_id: OWNER_ID }] },
      { rows: [{ id: ARTIFACT_ID, author_id: AGENT_ID, type: "document" }] },
    ]);
    const req = new Request(
      `http://localhost/api/challenges/${SLUG}/submissions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: ownerToken(),
        },
        body: JSON.stringify({ agent_id: AGENT_ID, artifact_id: ARTIFACT_ID }),
      }
    );
    const res = await handleCreateSubmission(req, pool as any, SLUG);
    expect(res.status).toBe(400);
  });

  it("returns 201 on successful submission", async () => {
    const { pool, calls } = makePool([
      {
        rows: [
          {
            id: CHALLENGE_ID,
            agent_type_filter: ["code_diff"],
            status: "active",
            starts_at: new Date(Date.now() - 86400000),
            ends_at: new Date(Date.now() + 86400000),
          },
        ],
      },
      { rows: [{ id: AGENT_ID, builder_id: OWNER_ID }] },
      { rows: [{ id: ARTIFACT_ID, author_id: AGENT_ID, type: "code_diff" }] },
      {
        rows: [
          {
            id: "new-submission-id",
            challenge_id: CHALLENGE_ID,
            agent_id: AGENT_ID,
            artifact_id: ARTIFACT_ID,
            submitted_at: new Date(),
            vote_count: 0,
          },
        ],
      },
    ]);
    const req = new Request(
      `http://localhost/api/challenges/${SLUG}/submissions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: ownerToken(),
        },
        body: JSON.stringify({ agent_id: AGENT_ID, artifact_id: ARTIFACT_ID }),
      }
    );
    const res = await handleCreateSubmission(req, pool as any, SLUG);
    expect(res.status).toBe(201);
    expect(calls[3].sql).toMatch(/INSERT INTO challenge_submissions/i);
  });

  it("returns 409 when agent already submitted", async () => {
    const { pool } = makePool([
      {
        rows: [
          {
            id: CHALLENGE_ID,
            agent_type_filter: [],
            status: "active",
            starts_at: new Date(Date.now() - 86400000),
            ends_at: new Date(Date.now() + 86400000),
          },
        ],
      },
      { rows: [{ id: AGENT_ID, builder_id: OWNER_ID }] },
      { rows: [{ id: ARTIFACT_ID, author_id: AGENT_ID, type: "code_diff" }] },
      { reject: { code: "23505" } },
    ]);
    const req = new Request(
      `http://localhost/api/challenges/${SLUG}/submissions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: ownerToken(),
        },
        body: JSON.stringify({ agent_id: AGENT_ID, artifact_id: ARTIFACT_ID }),
      }
    );
    const res = await handleCreateSubmission(req, pool as any, SLUG);
    expect(res.status).toBe(409);
  });
});

describe("handleVoteSubmission", () => {
  it("returns 401 without Authorization", async () => {
    const { pool } = makePool([]);
    const req = new Request(
      `http://localhost/api/challenges/${SLUG}/submissions/${ARTIFACT_ID}/vote`,
      { method: "POST" }
    );
    const res = await handleVoteSubmission(req, pool as any, SLUG, ARTIFACT_ID);
    expect(res.status).toBe(401);
  });

  it("returns 400 for invalid artifact id", async () => {
    const { pool } = makePool([]);
    const req = new Request(
      `http://localhost/api/challenges/${SLUG}/submissions/not-a-uuid/vote`,
      { method: "POST", headers: { Authorization: ownerToken() } }
    );
    const res = await handleVoteSubmission(
      req,
      pool as any,
      SLUG,
      "not-a-uuid"
    );
    expect(res.status).toBe(400);
  });

  it("returns 404 when challenge not found", async () => {
    const { pool } = makePool([{ rows: [] }]);
    const req = new Request(
      `http://localhost/api/challenges/${SLUG}/submissions/${ARTIFACT_ID}/vote`,
      { method: "POST", headers: { Authorization: ownerToken() } }
    );
    const res = await handleVoteSubmission(req, pool as any, SLUG, ARTIFACT_ID);
    expect(res.status).toBe(404);
  });

  it("returns 404 when submission does not belong to challenge", async () => {
    const { pool } = makePool([
      { rows: [{ id: CHALLENGE_ID }] },
      { rows: [] },
    ]);
    const req = new Request(
      `http://localhost/api/challenges/${SLUG}/submissions/${ARTIFACT_ID}/vote`,
      { method: "POST", headers: { Authorization: ownerToken() } }
    );
    const res = await handleVoteSubmission(req, pool as any, SLUG, ARTIFACT_ID);
    expect(res.status).toBe(404);
  });

  it("returns 201 on first vote and bumps vote_count", async () => {
    const { pool, calls } = makePool([
      { rows: [{ id: CHALLENGE_ID }] },
      { rows: [{ id: "submission" }] },
      { rows: [{}] },
      { rows: [{ vote_count: 1 }] },
    ]);
    const req = new Request(
      `http://localhost/api/challenges/${SLUG}/submissions/${ARTIFACT_ID}/vote`,
      { method: "POST", headers: { Authorization: ownerToken() } }
    );
    const res = await handleVoteSubmission(req, pool as any, SLUG, ARTIFACT_ID);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.vote_count).toBe(1);
    // INSERT followed by UPDATE (aggregate bump)
    expect(calls[2].sql).toMatch(/INSERT INTO challenge_votes/i);
    expect(calls[3].sql).toMatch(/UPDATE challenge_submissions/i);
  });

  it("returns 200 and does not double-count on repeat vote", async () => {
    const { pool } = makePool([
      { rows: [{ id: CHALLENGE_ID }] },
      { rows: [{ id: "submission" }] },
      { reject: { code: "23505" } },
      { rows: [{ vote_count: 3 }] },
    ]);
    const req = new Request(
      `http://localhost/api/challenges/${SLUG}/submissions/${ARTIFACT_ID}/vote`,
      { method: "POST", headers: { Authorization: otherToken() } }
    );
    const res = await handleVoteSubmission(req, pool as any, SLUG, ARTIFACT_ID);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.vote_count).toBe(3);
    expect(body.already_voted).toBe(true);
  });
});

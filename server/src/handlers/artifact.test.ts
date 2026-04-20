import { describe, it, expect, mock } from "bun:test";
import { handleArtifactGet, type Requester } from "./artifact";

const ARTIFACT_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const AUTHOR_AGENT_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const AUTHOR_BUILDER_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const AUTHOR_COMPANY_ID = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const OTHER_BUILDER_ID = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
const OTHER_COMPANY_ID = "ffffffff-ffff-ffff-ffff-ffffffffffff";
const REQUESTER_AGENT_ID = "11111111-1111-1111-1111-111111111111";

const SECRET_CONTENT = "the secret sauce recipe v2";

type FakeRow = {
  id: string;
  type: string;
  title: string;
  content: string;
  status: string;
  created_at: Date;
  updated_at: Date;
  author_id: string;
  author_name: string;
  author_builder_id: string;
  author_company_id: string | null;
  author_is_artifact_content_public: boolean;
  company_id: string;
  company_name: string;
};

function makeRow(overrides: Partial<FakeRow> = {}): FakeRow {
  return {
    id: ARTIFACT_ID,
    type: "doc",
    title: "Design doc",
    content: SECRET_CONTENT,
    status: "published",
    created_at: new Date("2026-04-20T00:00:00Z"),
    updated_at: new Date("2026-04-20T00:00:00Z"),
    author_id: AUTHOR_AGENT_ID,
    author_name: "Alice",
    author_builder_id: AUTHOR_BUILDER_ID,
    author_company_id: AUTHOR_COMPANY_ID,
    author_is_artifact_content_public: false,
    company_id: AUTHOR_COMPANY_ID,
    company_name: "Lyse",
    ...overrides,
  };
}

function makePool(row: FakeRow | null) {
  return {
    query: mock(async (_sql: string, _params: unknown[]) => ({
      rows: row === null ? [] : [row],
    })),
  };
}

const ANON: Requester = { kind: "anonymous" };
const OWNER_BUILDER: Requester = { kind: "builder", builder_id: AUTHOR_BUILDER_ID };
const OTHER_BUILDER: Requester = { kind: "builder", builder_id: OTHER_BUILDER_ID };
const SAME_COMPANY_AGENT: Requester = {
  kind: "agent",
  agent_id: REQUESTER_AGENT_ID,
  builder_id: OTHER_BUILDER_ID,
  company_id: AUTHOR_COMPANY_ID,
};
const OTHER_COMPANY_AGENT: Requester = {
  kind: "agent",
  agent_id: REQUESTER_AGENT_ID,
  builder_id: OTHER_BUILDER_ID,
  company_id: OTHER_COMPANY_ID,
};

describe("handleArtifactGet", () => {
  it("returns 404 for invalid UUID", async () => {
    const pool = makePool(null);
    const res = await handleArtifactGet("not-a-uuid", pool as any, ANON);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("not_found");
  });

  it("returns 404 when artifact does not exist", async () => {
    const pool = makePool(null);
    const res = await handleArtifactGet(ARTIFACT_ID, pool as any, ANON);
    expect(res.status).toBe(404);
  });

  it("anonymous + private returns metadata only (no content)", async () => {
    const pool = makePool(makeRow({ author_is_artifact_content_public: false }));
    const res = await handleArtifactGet(ARTIFACT_ID, pool as any, ANON);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.artifact.id).toBe(ARTIFACT_ID);
    expect(body.artifact.title).toBe("Design doc");
    expect(body.artifact.author_name).toBe("Alice");
    expect(body.artifact.content).toBeUndefined();
    expect(body.artifact.content_public).toBe(false);
  });

  it("anonymous + public returns full content", async () => {
    const pool = makePool(makeRow({ author_is_artifact_content_public: true }));
    const res = await handleArtifactGet(ARTIFACT_ID, pool as any, ANON);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.artifact.content).toBe(SECRET_CONTENT);
    expect(body.artifact.content_public).toBe(true);
  });

  it("owner builder + private returns full content", async () => {
    const pool = makePool(makeRow({ author_is_artifact_content_public: false }));
    const res = await handleArtifactGet(ARTIFACT_ID, pool as any, OWNER_BUILDER);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.artifact.content).toBe(SECRET_CONTENT);
  });

  it("non-owner builder + private returns metadata only", async () => {
    const pool = makePool(makeRow({ author_is_artifact_content_public: false }));
    const res = await handleArtifactGet(ARTIFACT_ID, pool as any, OTHER_BUILDER);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.artifact.content).toBeUndefined();
  });

  it("agent in same company + private returns full content", async () => {
    const pool = makePool(makeRow({ author_is_artifact_content_public: false }));
    const res = await handleArtifactGet(ARTIFACT_ID, pool as any, SAME_COMPANY_AGENT);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.artifact.content).toBe(SECRET_CONTENT);
  });

  it("agent in different company + private returns metadata only", async () => {
    const pool = makePool(makeRow({ author_is_artifact_content_public: false }));
    const res = await handleArtifactGet(ARTIFACT_ID, pool as any, OTHER_COMPANY_AGENT);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.artifact.content).toBeUndefined();
  });

  it("agent in same company + public returns full content (public flag wins)", async () => {
    const pool = makePool(makeRow({ author_is_artifact_content_public: true }));
    const res = await handleArtifactGet(ARTIFACT_ID, pool as any, OTHER_COMPANY_AGENT);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.artifact.content).toBe(SECRET_CONTENT);
  });

  it("metadata-only response still includes id, type, title, author, company, status, timestamps", async () => {
    const pool = makePool(makeRow({ author_is_artifact_content_public: false }));
    const res = await handleArtifactGet(ARTIFACT_ID, pool as any, ANON);
    const body = await res.json();
    const art = body.artifact;
    expect(art.id).toBe(ARTIFACT_ID);
    expect(art.type).toBe("doc");
    expect(art.title).toBe("Design doc");
    expect(art.author_id).toBe(AUTHOR_AGENT_ID);
    expect(art.author_name).toBe("Alice");
    expect(art.company_id).toBe(AUTHOR_COMPANY_ID);
    expect(art.company_name).toBe("Lyse");
    expect(art.status).toBe("published");
    expect(art.created_at).toBeDefined();
    expect(art.updated_at).toBeDefined();
  });
});

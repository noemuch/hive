import { describe, it, expect, mock, beforeAll, afterAll } from "bun:test";
import {
  handleProvenanceGet,
  handleProvenanceVerify,
  loadPeerEvalChain,
} from "./artifact-provenance";
import {
  buildProvenanceManifest,
  generateAgentKeypair,
  signManifest,
  type SignedProvenance,
} from "../crypto/c2pa";

const TEST_KEY_HEX = "0".repeat(64);
let previous: string | undefined;

beforeAll(() => {
  previous = process.env.LLM_KEYS_MASTER_KEY;
  process.env.LLM_KEYS_MASTER_KEY = TEST_KEY_HEX;
});
afterAll(() => {
  if (previous === undefined) delete process.env.LLM_KEYS_MASTER_KEY;
  else process.env.LLM_KEYS_MASTER_KEY = previous;
});

const ARTIFACT_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const AGENT_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const EVAL_ID_1 = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const EVAL_ID_2 = "dddddddd-dddd-dddd-dddd-dddddddddddd";

function signedFor(title: string, content: string): SignedProvenance {
  const kp = generateAgentKeypair();
  const manifest = buildProvenanceManifest({
    agent_id: AGENT_ID,
    agent_pubkey: kp.public_key,
    model_used: "claude-sonnet-4-6",
    created_at: new Date("2026-04-21T10:00:00.000Z"),
    artifact: { title, content, media_url: null },
    input: null,
    peer_eval_chain: [],
  });
  const signature = signManifest(manifest, kp.private_key_encrypted);
  return { manifest, signature };
}

type FakeRow = {
  id: string;
  title: string;
  content: string | null;
  media_url: string | null;
  provenance: SignedProvenance | null;
};

function poolFor(row: FakeRow | null, peerRows: unknown[] = []) {
  return {
    query: mock(async (sql: string, _params: unknown[]) => {
      if (sql.includes("FROM peer_evaluations")) {
        return { rows: peerRows };
      }
      return { rows: row === null ? [] : [row] };
    }),
  };
}

describe("GET /api/artifacts/:id/provenance", () => {
  it("returns 404 for a malformed UUID", async () => {
    const res = await handleProvenanceGet("not-a-uuid", poolFor(null));
    expect(res.status).toBe(404);
  });

  it("returns 404 when artefact is missing", async () => {
    const res = await handleProvenanceGet(ARTIFACT_ID, poolFor(null));
    expect(res.status).toBe(404);
  });

  it("returns 404 when artefact has no provenance persisted", async () => {
    const res = await handleProvenanceGet(
      ARTIFACT_ID,
      poolFor({
        id: ARTIFACT_ID,
        title: "t",
        content: "c",
        media_url: null,
        provenance: null,
      }),
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("not_signed");
  });

  it("returns the manifest + signature + live peer-eval chain", async () => {
    const signed = signedFor("t", "c");
    const res = await handleProvenanceGet(
      ARTIFACT_ID,
      poolFor(
        {
          id: ARTIFACT_ID,
          title: "t",
          content: "c",
          media_url: null,
          provenance: signed,
        },
        [
          {
            evaluator_agent_id: EVAL_ID_1,
            evaluator_name: "Bodhi",
            evaluator_reliability: "0.89",
            scores: { helpfulness: 7, accuracy: 8 },
          },
        ],
      ),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      provenance: {
        signature: string;
        manifest: { agent_id: string };
        peer_eval_chain: { evaluator_name: string; score_mean: number }[];
      };
    };
    expect(body.provenance.signature).toBe(signed.signature);
    expect(body.provenance.manifest.agent_id).toBe(AGENT_ID);
    expect(body.provenance.peer_eval_chain).toHaveLength(1);
    expect(body.provenance.peer_eval_chain[0].evaluator_name).toBe("Bodhi");
    expect(body.provenance.peer_eval_chain[0].score_mean).toBe(7.5);
  });
});

describe("POST /api/artifacts/:id/verify", () => {
  it("returns ok=true for an untampered artefact", async () => {
    const signed = signedFor("stable-title", "stable-content");
    const res = await handleProvenanceVerify(
      ARTIFACT_ID,
      poolFor({
        id: ARTIFACT_ID,
        title: "stable-title",
        content: "stable-content",
        media_url: null,
        provenance: signed,
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      checks: { signature: boolean; artifact_hash: boolean };
    };
    expect(body.ok).toBe(true);
    expect(body.checks.signature).toBe(true);
    expect(body.checks.artifact_hash).toBe(true);
  });

  it("returns ok=false when stored content no longer matches hash", async () => {
    const signed = signedFor("orig", "orig");
    const res = await handleProvenanceVerify(
      ARTIFACT_ID,
      poolFor({
        id: ARTIFACT_ID,
        title: "orig",
        content: "TAMPERED",
        media_url: null,
        provenance: signed,
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      checks: { signature: boolean; artifact_hash: boolean };
    };
    expect(body.ok).toBe(false);
    expect(body.checks.artifact_hash).toBe(false);
    expect(body.checks.signature).toBe(true);
  });

  it("returns 404 for missing artefact", async () => {
    const res = await handleProvenanceVerify(ARTIFACT_ID, poolFor(null));
    expect(res.status).toBe(404);
  });
});

describe("loadPeerEvalChain", () => {
  it("averages numeric scores and rounds to 2 decimals", async () => {
    const pool = {
      query: mock(async () => ({
        rows: [
          {
            evaluator_agent_id: EVAL_ID_1,
            evaluator_name: "A",
            evaluator_reliability: 0.5,
            scores: { x: 1, y: 2, z: 3.3333 },
          },
          {
            evaluator_agent_id: EVAL_ID_2,
            evaluator_name: null,
            evaluator_reliability: null,
            scores: null,
          },
        ],
      })),
    };
    const chain = await loadPeerEvalChain(pool, ARTIFACT_ID);
    expect(chain).toHaveLength(2);
    expect(chain[0].score_mean).toBe(2.11);
    expect(chain[1].evaluator_reliability).toBe(0);
    expect(chain[1].score_mean).toBe(0);
  });
});

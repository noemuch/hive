// Provenance endpoints for C2PA-style verification (#244).
//
// GET  /api/artifacts/:id/provenance
//   Returns the signed manifest persisted at creation time, enriched
//   on-the-fly with the current peer-evaluation chain (IDs + mean scores +
//   evaluator reliability). The signature only covers the at-creation
//   manifest — the peer-eval chain is advisory metadata, not part of the
//   signed payload, so appending evaluations after the fact can't break
//   verification.
//
// POST /api/artifacts/:id/verify
//   Recomputes the artefact_hash from the DB row and verifies the stored
//   Ed25519 signature over the stored manifest. Returns `{ ok: true | false,
//   checks: { signature, artifact_hash } }`.

import type { Pool } from "pg";
import { json } from "../http/response";
import type { Route } from "../router/route-types";
import { logAndWrap } from "../router/middleware";
import {
  hashArtifactPayload,
  verifyManifest,
  type ProvenanceManifest,
  type SignedProvenance,
  type PeerEvalChainEntry,
} from "../crypto/c2pa";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type QueryablePool = Pick<Pool, "query">;

type ArtifactRow = {
  id: string;
  title: string;
  content: string | null;
  media_url: string | null;
  provenance: SignedProvenance | null;
};

type PeerEvalRow = {
  evaluator_agent_id: string;
  evaluator_name: string | null;
  evaluator_reliability: string | number | null;
  scores: Record<string, number> | null;
};

export async function loadPeerEvalChain(
  pool: QueryablePool,
  artifactId: string,
): Promise<PeerEvalChainEntry[]> {
  const { rows } = await pool.query<PeerEvalRow>(
    `SELECT pe.evaluator_agent_id,
            a.name AS evaluator_name,
            a.eval_reliability AS evaluator_reliability,
            pe.scores
     FROM peer_evaluations pe
     LEFT JOIN agents a ON a.id = pe.evaluator_agent_id
     WHERE pe.artifact_id = $1 AND pe.status = 'completed'
     ORDER BY pe.completed_at ASC
     LIMIT 20`,
    [artifactId],
  );
  return rows.map((r) => {
    const scoresObj = r.scores ?? {};
    const nums = Object.values(scoresObj)
      .map((v) => Number(v))
      .filter((n) => Number.isFinite(n));
    const mean = nums.length === 0 ? 0 : nums.reduce((a, b) => a + b, 0) / nums.length;
    return {
      evaluator_id: r.evaluator_agent_id,
      evaluator_name: r.evaluator_name,
      evaluator_reliability:
        r.evaluator_reliability === null ? 0 : Number(r.evaluator_reliability),
      score_mean: Math.round(mean * 100) / 100,
    };
  });
}

export async function handleProvenanceGet(
  artifactId: string,
  pool: QueryablePool,
): Promise<Response> {
  if (!UUID_RE.test(artifactId)) {
    return json({ error: "not_found", message: "Artifact not found" }, 404);
  }
  const { rows } = await pool.query<ArtifactRow>(
    `SELECT id, title, content, media_url, provenance
     FROM artifacts
     WHERE id = $1`,
    [artifactId],
  );
  if (rows.length === 0) {
    return json({ error: "not_found", message: "Artifact not found" }, 404);
  }
  const row = rows[0];
  if (!row.provenance) {
    return json(
      { error: "not_signed", message: "This artefact was not signed" },
      404,
    );
  }
  const chain = await loadPeerEvalChain(pool, artifactId);
  return json({
    provenance: {
      manifest: row.provenance.manifest,
      signature: row.provenance.signature,
      peer_eval_chain: chain,
    },
  });
}

export type VerifyResult = {
  ok: boolean;
  checks: {
    signature: boolean;
    artifact_hash: boolean;
  };
  manifest: ProvenanceManifest | null;
};

export async function handleProvenanceVerify(
  artifactId: string,
  pool: QueryablePool,
): Promise<Response> {
  if (!UUID_RE.test(artifactId)) {
    return json({ error: "not_found", message: "Artifact not found" }, 404);
  }
  const { rows } = await pool.query<ArtifactRow>(
    `SELECT id, title, content, media_url, provenance
     FROM artifacts
     WHERE id = $1`,
    [artifactId],
  );
  if (rows.length === 0) {
    return json({ error: "not_found", message: "Artifact not found" }, 404);
  }
  const row = rows[0];
  if (!row.provenance) {
    return json(
      { error: "not_signed", message: "This artefact was not signed" },
      404,
    );
  }
  const { manifest, signature } = row.provenance;

  const recomputedHash = hashArtifactPayload({
    title: row.title,
    content: row.content,
    media_url: row.media_url,
  });
  const hashOk = recomputedHash === manifest.artifact_hash;
  const sigOk = verifyManifest(manifest, signature);

  const result: VerifyResult = {
    ok: hashOk && sigOk,
    checks: { signature: sigOk, artifact_hash: hashOk },
    manifest,
  };
  return json(result);
}

export const routes: Route[] = [
  {
    method: "GET",
    path: "/api/artifacts/:id/provenance",
    handler: logAndWrap(
      (ctx) => handleProvenanceGet(ctx.params.id, ctx.pool),
      "artifact-provenance",
    ),
  },
  {
    method: "POST",
    path: "/api/artifacts/:id/verify",
    handler: logAndWrap(
      (ctx) => handleProvenanceVerify(ctx.params.id, ctx.pool),
      "artifact-verify",
    ),
  },
];

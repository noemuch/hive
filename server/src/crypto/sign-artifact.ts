// Sign an artefact at creation time: generate/fetch the agent's active
// keypair, compute the manifest, persist signed provenance on
// artifacts.provenance. Peer-eval chain is NOT included here — it's
// hydrated on read via `/api/artifacts/:id/provenance` since peer evals
// complete asynchronously after creation.

import type { Pool } from "pg";
import {
  buildProvenanceManifest,
  signManifest,
  type SignedProvenance,
} from "./c2pa";
import { getOrCreateActiveKeypair } from "./agent-keypairs";

type QueryablePool = Pick<Pool, "query">;

export type SignArtifactInput = {
  artifact_id: string;
  agent_id: string;
  title: string;
  content: string | null;
  media_url: string | null;
  created_at: Date;
  model_used: string | null;
};

export async function signAndPersistArtifactProvenance(
  pool: QueryablePool,
  i: SignArtifactInput,
): Promise<SignedProvenance> {
  const kp = await getOrCreateActiveKeypair(pool, i.agent_id);
  const manifest = buildProvenanceManifest({
    agent_id: i.agent_id,
    agent_pubkey: kp.public_key,
    model_used: i.model_used,
    created_at: i.created_at,
    artifact: { title: i.title, content: i.content, media_url: i.media_url },
    input: null,
    peer_eval_chain: [],
  });
  const signature = signManifest(manifest, kp.private_key_encrypted);
  const signed: SignedProvenance = { manifest, signature };
  await pool.query(
    `UPDATE artifacts SET provenance = $1::jsonb WHERE id = $2`,
    [JSON.stringify(signed), i.artifact_id],
  );
  return signed;
}

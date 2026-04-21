// C2PA-style cryptographic provenance for agent-produced artefacts (#244 A16).
//
// Every artefact gets a signed manifest proving: which agent produced it,
// when, with which model, over what input, and which peer evaluations
// contributed to its score. Signatures use Ed25519 (raw, detached, no X.509),
// generated and verified with node:crypto — no third-party dependencies.
//
// Canonicalization: signatures are computed over sorted-key JSON so two
// structurally-identical manifests produce the exact same bytes regardless
// of how their keys were inserted. This is the minimal thing needed to
// interoperate with off-the-shelf Ed25519 verifiers.
//
// This module is DB-free on purpose — `handlers/artifact-provenance.ts`
// handles persistence. Keeps the crypto layer mockable and fast to test.

import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as nodeSign,
  verify as nodeVerify,
} from "node:crypto";
import { encryptLLMKey, decryptLLMKey } from "../security/key-encryption";

export const MANIFEST_VERSION = "hive-c2pa-1";

export type PeerEvalChainEntry = {
  evaluator_id: string;
  evaluator_name: string | null;
  evaluator_reliability: number;
  score_mean: number;
};

export type ProvenanceManifest = {
  version: typeof MANIFEST_VERSION;
  agent_id: string;
  agent_pubkey: string;
  model_used: string | null;
  created_at: string;
  artifact_hash: string;
  input_hash: string | null;
  peer_eval_chain: PeerEvalChainEntry[];
};

export type SignedProvenance = {
  manifest: ProvenanceManifest;
  signature: string;
};

/** Stable JSON serializer: keys sorted, arrays preserved. */
export function canonicalJSON(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map((v) => canonicalJSON(v)).join(",") + "]";
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return (
    "{" +
    keys
      .map((k) => JSON.stringify(k) + ":" + canonicalJSON(obj[k]))
      .join(",") +
    "}"
  );
}

export type HashableArtifact = {
  title: string;
  content: string | null;
  media_url: string | null;
};

export function hashArtifactPayload(a: HashableArtifact): string {
  const bytes = canonicalJSON({
    title: a.title,
    content: a.content ?? "",
    media_url: a.media_url ?? "",
  });
  const digest = createHash("sha256").update(bytes, "utf8").digest("hex");
  return "sha256:" + digest;
}

export function hashInput(input: string | null): string | null {
  if (!input) return null;
  return "sha256:" + createHash("sha256").update(input, "utf8").digest("hex");
}

export type GeneratedKeypair = {
  public_key: string;
  private_key_encrypted: string;
};

/** Generate a fresh Ed25519 keypair. Private key is AES-encrypted at rest. */
export function generateAgentKeypair(): GeneratedKeypair {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pubRaw = publicKey.export({ format: "der", type: "spki" });
  // DER SPKI for Ed25519 is 44 bytes: 12-byte header + 32-byte raw key.
  // Slice off the header so we store just the 32 bytes — cheaper to transport
  // and matches what third-party verifiers expect as "raw public key".
  const rawPub = pubRaw.subarray(pubRaw.length - 32);
  const privPem = privateKey.export({ format: "pem", type: "pkcs8" }) as string;
  return {
    public_key: rawPub.toString("base64"),
    private_key_encrypted: encryptLLMKey(privPem),
  };
}

function rawPubToKeyObject(rawBase64: string) {
  const raw = Buffer.from(rawBase64, "base64");
  if (raw.length !== 32) {
    throw new Error("Ed25519 public key must decode to 32 bytes");
  }
  // Rebuild the SPKI prefix node expects for imports.
  const spkiHeader = Buffer.from("302a300506032b6570032100", "hex");
  return createPublicKey({
    key: Buffer.concat([spkiHeader, raw]),
    format: "der",
    type: "spki",
  });
}

export function signManifest(
  manifest: ProvenanceManifest,
  encryptedPrivatePem: string,
): string {
  const privPem = decryptLLMKey(encryptedPrivatePem);
  const keyObj = createPrivateKey({ key: privPem, format: "pem" });
  const signature = nodeSign(null, Buffer.from(canonicalJSON(manifest), "utf8"), keyObj);
  return signature.toString("base64");
}

export function verifyManifest(
  manifest: ProvenanceManifest,
  signatureBase64: string,
): boolean {
  try {
    const keyObj = rawPubToKeyObject(manifest.agent_pubkey);
    const sig = Buffer.from(signatureBase64, "base64");
    if (sig.length === 0) return false;
    return nodeVerify(
      null,
      Buffer.from(canonicalJSON(manifest), "utf8"),
      keyObj,
      sig,
    );
  } catch {
    return false;
  }
}

export type BuildManifestInput = {
  agent_id: string;
  agent_pubkey: string;
  model_used: string | null;
  created_at: Date;
  artifact: HashableArtifact;
  input: string | null;
  peer_eval_chain: PeerEvalChainEntry[];
};

export function buildProvenanceManifest(
  i: BuildManifestInput,
): ProvenanceManifest {
  return {
    version: MANIFEST_VERSION,
    agent_id: i.agent_id,
    agent_pubkey: i.agent_pubkey,
    model_used: i.model_used,
    created_at: i.created_at.toISOString(),
    artifact_hash: hashArtifactPayload(i.artifact),
    input_hash: hashInput(i.input),
    peer_eval_chain: i.peer_eval_chain,
  };
}

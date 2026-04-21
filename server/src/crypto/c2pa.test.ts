import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import {
  generateAgentKeypair,
  hashArtifactPayload,
  canonicalJSON,
  signManifest,
  verifyManifest,
  buildProvenanceManifest,
  type ProvenanceManifest,
} from "./c2pa";

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

describe("canonicalJSON", () => {
  it("emits keys in sorted order so the same object produces the same bytes", () => {
    const a = canonicalJSON({ b: 1, a: 2, c: 3 });
    const b = canonicalJSON({ c: 3, a: 2, b: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":2,"b":1,"c":3}');
  });

  it("recurses into nested objects and arrays deterministically", () => {
    const x = canonicalJSON({
      outer: { z: [3, 2, 1], a: { y: 2, x: 1 } },
    });
    const y = canonicalJSON({
      outer: { a: { x: 1, y: 2 }, z: [3, 2, 1] },
    });
    expect(x).toBe(y);
  });
});

describe("hashArtifactPayload", () => {
  it("hashes title + content + media_url deterministically", () => {
    const a = hashArtifactPayload({
      title: "Report",
      content: "hello",
      media_url: null,
    });
    const b = hashArtifactPayload({
      title: "Report",
      content: "hello",
      media_url: null,
    });
    expect(a).toBe(b);
    expect(a).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("changes when any field changes", () => {
    const base = { title: "t", content: "c", media_url: null };
    const h0 = hashArtifactPayload(base);
    expect(h0).not.toBe(
      hashArtifactPayload({ ...base, title: "T" }),
    );
    expect(h0).not.toBe(
      hashArtifactPayload({ ...base, content: "C" }),
    );
    expect(h0).not.toBe(
      hashArtifactPayload({ ...base, media_url: "https://cdn/x.png" }),
    );
  });
});

describe("generateAgentKeypair", () => {
  it("produces a usable Ed25519 keypair (base64 pub + encrypted priv)", () => {
    const kp = generateAgentKeypair();
    // Raw Ed25519 public key is 32 bytes → 44 base64 chars (no padding) or 44 with padding.
    expect(Buffer.from(kp.public_key, "base64").length).toBe(32);
    expect(kp.private_key_encrypted.startsWith("v1:")).toBe(true);
  });

  it("produces distinct keypairs every call", () => {
    const a = generateAgentKeypair();
    const b = generateAgentKeypair();
    expect(a.public_key).not.toBe(b.public_key);
  });
});

describe("signManifest / verifyManifest", () => {
  it("verifies a valid signature", () => {
    const kp = generateAgentKeypair();
    const manifest: ProvenanceManifest = {
      version: "hive-c2pa-1",
      agent_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      agent_pubkey: kp.public_key,
      model_used: "claude-sonnet-4-6",
      created_at: "2026-04-21T10:00:00.000Z",
      artifact_hash: "sha256:" + "a".repeat(64),
      input_hash: null,
      peer_eval_chain: [],
    };
    const signature = signManifest(manifest, kp.private_key_encrypted);
    expect(signature).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(verifyManifest(manifest, signature)).toBe(true);
  });

  it("rejects a tampered manifest", () => {
    const kp = generateAgentKeypair();
    const manifest: ProvenanceManifest = {
      version: "hive-c2pa-1",
      agent_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      agent_pubkey: kp.public_key,
      model_used: "claude-sonnet-4-6",
      created_at: "2026-04-21T10:00:00.000Z",
      artifact_hash: "sha256:" + "a".repeat(64),
      input_hash: null,
      peer_eval_chain: [],
    };
    const signature = signManifest(manifest, kp.private_key_encrypted);
    const tampered: ProvenanceManifest = {
      ...manifest,
      artifact_hash: "sha256:" + "b".repeat(64),
    };
    expect(verifyManifest(tampered, signature)).toBe(false);
  });

  it("rejects a signature produced by a different key", () => {
    const kp1 = generateAgentKeypair();
    const kp2 = generateAgentKeypair();
    const manifest: ProvenanceManifest = {
      version: "hive-c2pa-1",
      agent_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      agent_pubkey: kp1.public_key,
      model_used: "m",
      created_at: "2026-04-21T10:00:00.000Z",
      artifact_hash: "sha256:" + "c".repeat(64),
      input_hash: null,
      peer_eval_chain: [],
    };
    const signedWithWrongKey = signManifest(manifest, kp2.private_key_encrypted);
    expect(verifyManifest(manifest, signedWithWrongKey)).toBe(false);
  });

  it("rejects malformed base64 signatures without throwing", () => {
    const kp = generateAgentKeypair();
    const manifest: ProvenanceManifest = {
      version: "hive-c2pa-1",
      agent_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      agent_pubkey: kp.public_key,
      model_used: "m",
      created_at: "2026-04-21T10:00:00.000Z",
      artifact_hash: "sha256:" + "d".repeat(64),
      input_hash: null,
      peer_eval_chain: [],
    };
    expect(verifyManifest(manifest, "not-a-signature")).toBe(false);
  });
});

describe("buildProvenanceManifest", () => {
  it("includes all required fields + canonicalizes timestamp", () => {
    const kp = generateAgentKeypair();
    const manifest = buildProvenanceManifest({
      agent_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      agent_pubkey: kp.public_key,
      model_used: "mistral-small-latest",
      created_at: new Date("2026-04-21T10:00:00.123Z"),
      artifact: { title: "x", content: "y", media_url: null },
      input: null,
      peer_eval_chain: [],
    });
    expect(manifest.version).toBe("hive-c2pa-1");
    expect(manifest.agent_id).toBe(
      "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    );
    expect(manifest.created_at).toBe("2026-04-21T10:00:00.123Z");
    expect(manifest.artifact_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(manifest.input_hash).toBeNull();
  });
});

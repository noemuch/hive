/**
 * HEAR Judge Service — Sampling policy.
 *
 * Implements Component 1 of HEAR-methodology.md:
 *
 *   decision  : 100% (complexity ≥ 200 chars)
 *   spec      : 80%  (complexity ≥ 500 chars)
 *   pr        : 80%  (complexity ≥ 200 chars)
 *   component : 60%  (complexity ≥ 200 chars)
 *   document  : 60%  (complexity ≥ 200 chars)
 *   ticket    : 30%  (complexity ≥ 200 chars)
 *
 * Sampling is deterministic for reproducibility:
 *   bucket = first 8 hex chars of sha256(artifact_id + ':' + YYYY-MM-DD)
 *   include if bucket / 0xffffffff < rate
 *
 * Same artifact + same day → same decision. Different days → independent draw,
 * so an artifact missed today still has a chance tomorrow (within retention).
 */

import { createHash } from "node:crypto";

export type ArtifactType =
  | "decision"
  | "spec"
  | "pr"
  | "component"
  | "document"
  | "ticket";

export type SamplingPolicy = {
  rate: number;
  minChars: number;
};

export const SAMPLING_POLICY: Record<ArtifactType, SamplingPolicy> = {
  decision:  { rate: 1.0, minChars: 200 },
  spec:      { rate: 0.8, minChars: 500 },
  pr:        { rate: 0.8, minChars: 200 },
  component: { rate: 0.6, minChars: 200 },
  document:  { rate: 0.6, minChars: 200 },
  ticket:    { rate: 0.3, minChars: 200 },
};

export type SamplingDecision = {
  artifactId: string;
  type: string;
  contentLength: number;
  included: boolean;
  reason: string;
  bucket: number; // 0..1
};

function todayKey(now: Date = new Date()): string {
  // YYYY-MM-DD in UTC, matches the nightly batch's logical day
  return now.toISOString().slice(0, 10);
}

/**
 * Deterministic 32-bit bucket in [0, 1) derived from artifact id + day.
 * Same input → same output across runs.
 */
export function sampleBucket(artifactId: string, day: string): number {
  const hash = createHash("sha256")
    .update(`${artifactId}:${day}`)
    .digest("hex");
  const slice = hash.slice(0, 8); // 32 bits
  const intVal = parseInt(slice, 16);
  return intVal / 0xffffffff;
}

export function decideArtifact(
  artifact: { id: string; type: string; content: string | null },
  now: Date = new Date(),
): SamplingDecision {
  const day = todayKey(now);
  const len = (artifact.content ?? "").length;
  const policy = SAMPLING_POLICY[artifact.type as ArtifactType];

  if (!policy) {
    return {
      artifactId: artifact.id,
      type: artifact.type,
      contentLength: len,
      included: false,
      reason: `unknown artifact type "${artifact.type}"`,
      bucket: 0,
    };
  }

  if (len < policy.minChars) {
    return {
      artifactId: artifact.id,
      type: artifact.type,
      contentLength: len,
      included: false,
      reason: `below complexity threshold (${len} < ${policy.minChars})`,
      bucket: 0,
    };
  }

  const bucket = sampleBucket(artifact.id, day);
  const included = bucket < policy.rate;
  return {
    artifactId: artifact.id,
    type: artifact.type,
    contentLength: len,
    included,
    reason: included
      ? `sampled (bucket ${bucket.toFixed(4)} < rate ${policy.rate})`
      : `not sampled (bucket ${bucket.toFixed(4)} ≥ rate ${policy.rate})`,
    bucket,
  };
}

/**
 * Apply the sampling policy to a batch of artifacts. Returns both the
 * included artifacts and a per-artifact audit trail (useful for --dry-run).
 */
export function sampleBatch<
  T extends { id: string; type: string; content: string | null },
>(artifacts: T[], now: Date = new Date()): {
  included: T[];
  decisions: SamplingDecision[];
} {
  const decisions: SamplingDecision[] = [];
  const included: T[] = [];
  for (const a of artifacts) {
    const d = decideArtifact(a, now);
    decisions.push(d);
    if (d.included) included.push(a);
  }
  return { included, decisions };
}

/**
 * HEAR Canary Detection — loads manifest and scans text for contamination.
 *
 * Two detection methods:
 *   1. GUID scan: exact match of canary UUIDs (zero false positive)
 *   2. Fragment scan: verbatim rubric phrases (warning signal, not proof)
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dir, "..", "..", "..");

export type CanaryManifest = {
  version: string;
  generated_at: string;
  canaries: Record<string, string>; // filepath → GUID
};

export type ScanResult = {
  guidsFound: string[];
  fragmentsFound: string[];
  /** True if any GUID was found (proven contamination). */
  contaminated: boolean;
  /** True if >= 3 distinct fragments found (suspected contamination). */
  fragmentWarning: boolean;
};

/** Distinctive rubric phrases unlikely to appear in general text. */
const RUBRIC_FRAGMENTS = [
  "pathologically passive/active",
  "multi-level with metacognition",
  "token gestures at reasoning",
  "Gricean maxim violations",
  "pre-mortem reasoning",
  "recognize when to defer to better-positioned",
  "sophisticated metacognition",
  "behavioral consistency over time",
  "frame problem understanding",
  "recognition-primed decision",
];

const FRAGMENT_THRESHOLD = 3;

export function loadCanaryManifest(): CanaryManifest {
  const path = join(PROJECT_ROOT, "docs", "research", "calibration", "canary-manifest.json");
  return JSON.parse(readFileSync(path, "utf-8"));
}

export function scanForCanaries(text: string, manifest: CanaryManifest): ScanResult {
  const lowerText = text.toLowerCase();

  // 1. GUID scan — exact match
  const allGuids = Object.values(manifest.canaries);
  const guidsFound = allGuids.filter((guid) => lowerText.includes(guid.toLowerCase()));

  // 2. Fragment scan — case-insensitive verbatim match
  const fragmentsFound = RUBRIC_FRAGMENTS.filter((frag) =>
    lowerText.includes(frag.toLowerCase()),
  );

  return {
    guidsFound,
    fragmentsFound,
    contaminated: guidsFound.length > 0,
    fragmentWarning: fragmentsFound.length >= FRAGMENT_THRESHOLD,
  };
}

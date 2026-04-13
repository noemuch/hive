// server/src/engine/rubric-loader.ts
/**
 * Loads the full HEAR BARS rubric from docs/research/HEAR-rubric.md.
 * Read once at import time, cached for the lifetime of the process.
 * Used by peer-evaluation.ts to send rich evaluation context to agents.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const RUBRIC_PATH = join(import.meta.dir, "..", "..", "..", "docs", "research", "HEAR-rubric.md");

const FALLBACK_RUBRIC = `Score each axis from 1-10:
- reasoning_depth: Quality of explicit reasoning. Are premises stated? Alternatives considered?
- decision_wisdom: Trade-offs explicit? Second-order consequences anticipated? Reversibility considered?
- communication_clarity: Concise, relevant, well-structured? Follows Grice's maxims?
- initiative_quality: Proactive without noise? Acts at the right time?
- collaborative_intelligence: Builds on others? References teammates? Integrates feedback?
- self_awareness_calibration: Calibrated confidence? Asks for help when stuck?
- contextual_judgment: Adapts tone and depth to audience and situation?

Set to null if an axis is not applicable to this artifact type.`;

let _cachedRubric: string | null = null;

export function getPeerEvalRubric(): string {
  if (_cachedRubric !== null) return _cachedRubric;

  try {
    _cachedRubric = readFileSync(RUBRIC_PATH, "utf-8");
    console.log(`[rubric-loader] Loaded HEAR rubric (${_cachedRubric.length} chars)`);
  } catch {
    console.warn(`[rubric-loader] HEAR-rubric.md not found at ${RUBRIC_PATH}, using fallback`);
    _cachedRubric = FALLBACK_RUBRIC;
  }

  return _cachedRubric;
}

import { type Axis, AXES } from "./rubric";

export type AxisScore = {
  thinking?: string;
  score: number | null;
  justification: string;
  evidence_quotes: string[];
  confidence: number;
};

export type ItemGrade = {
  item_id: string;
  grader: string;
  rubric_version: string;
  prompt_version?: string;
  graded_at: string;
  scores: Record<Axis, AxisScore>;
};

export type GradesFile = {
  grader: string;
  grader_background?: string;
  rubric_version: string;
  started_at: string;
  updated_at: string;
  items: ItemGrade[];
};

export function emptyGradesFile(
  grader: string,
  background?: string,
): GradesFile {
  return {
    grader,
    grader_background: background,
    rubric_version: "1.0",
    started_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    items: [],
  };
}

export function validateItemGrade(grade: unknown): asserts grade is ItemGrade {
  if (typeof grade !== "object" || grade === null) {
    throw new Error("grade must be an object");
  }
  const g = grade as Record<string, unknown>;
  if (typeof g.item_id !== "string") throw new Error("missing item_id");
  if (typeof g.grader !== "string") throw new Error("missing grader");
  if (typeof g.scores !== "object" || g.scores === null)
    throw new Error("missing scores");

  const scores = g.scores as Record<string, unknown>;
  for (const axis of AXES) {
    const s = scores[axis];
    if (typeof s !== "object" || s === null)
      throw new Error(`missing score for axis ${axis}`);
    const sObj = s as Record<string, unknown>;
    if (sObj.score !== null && typeof sObj.score !== "number")
      throw new Error(`invalid score type for ${axis}`);
    if (
      sObj.score !== null &&
      (typeof sObj.score !== "number" ||
        sObj.score < 1 ||
        sObj.score > 10)
    )
      throw new Error(`score out of range for ${axis}`);
    if (typeof sObj.justification !== "string")
      throw new Error(`missing justification for ${axis}`);
    if (!Array.isArray(sObj.evidence_quotes))
      throw new Error(`missing evidence_quotes for ${axis}`);
  }
}

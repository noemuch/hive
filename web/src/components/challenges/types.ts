// Shared TypeScript types for the Challenge Gallery surfaces (issue #240).
// Mirrors the shape returned by server/src/handlers/challenges.ts.

import type { ArtifactType } from "../artifact/types";

export type ChallengeStatus = "draft" | "active" | "completed";

export type ChallengeSummary = {
  id: string;
  slug: string;
  title: string;
  prompt: string;
  agent_type_filter: string[];
  rubric_variant: string;
  starts_at: string;
  ends_at: string;
  status: ChallengeStatus;
  created_at: string;
  submission_count?: number;
};

export type Submission = {
  submission_id: string;
  agent_id: string;
  agent_name: string;
  agent_avatar_seed: string;
  artifact_id: string;
  artifact_type: ArtifactType;
  artifact_title: string | null;
  artifact_media_url: string | null;
  artifact_media_mime: string | null;
  submitted_at: string;
  vote_count: number;
  score_state_mu: number | null;
};

// ===== Agent → Server (Outgoing) =====

export type AuthEvent = {
  type: "auth";
  api_key: string;
};

export type SendMessageEvent = {
  type: "send_message";
  content: string;
  channel: string;
  thread_id?: string;
};

export type AddReactionEvent = {
  type: "add_reaction";
  emoji: string;
  target_message_id: string;
};

export type HeartbeatEvent = {
  type: "heartbeat";
};

export type SyncEvent = {
  type: "sync";
  last_seen: number; // unix timestamp ms
};

// Legacy text types (pre-A4) and A4 extension types for multi-archetype
// artefacts (image / audio / video / report / diff / action trace /
// structured JSON / embedding). Keep as a union so callers get exhaustive
// narrowing; DB CHECK in migration 041 must stay in sync.
export type ArtifactType =
  | "ticket" | "spec" | "decision" | "component" | "pr" | "document"
  | "message" | "code_diff" | "image" | "audio" | "video"
  | "report" | "action_trace" | "structured_json" | "embedding";
export type ReviewVerdict = "approve" | "request_changes" | "reject";

export type CreateArtifactEvent = {
  type: "create_artifact";
  artifact_type: ArtifactType;
  title: string;
  content?: string;
  media_url?: string;
  media_mime?: string;
};

export type UpdateArtifactEvent = {
  type: "update_artifact";
  artifact_id: string;
  status?: string;
  content?: string;
};

export type ReviewArtifactEvent = {
  type: "review_artifact";
  artifact_id: string;
  verdict: ReviewVerdict;
  comment?: string;
};

export type EvaluationResultEvent = {
  type: "evaluation_result";
  evaluation_id: string;
  scores: {
    reasoning_depth: number | null;
    decision_wisdom: number | null;
    communication_clarity: number | null;
    initiative_quality: number | null;
    collaborative_intelligence: number | null;
    self_awareness_calibration: number | null;
    contextual_judgment: number | null;
  };
  reasoning: string;
  confidence: number;
  // Verbatim quotes from the artifact that support the evaluation.
  // Two accepted shapes (the server tolerates both):
  //   (a) Legacy (#171): `string[]` — flat, up to 3 snippets <=200 chars.
  //   (b) Per-axis (#234 / A5): `{ [axis]: string[] }` — 1+ snippet per
  //       non-null scored axis, <=200 chars each. Rendered on the agent
  //       profile as tabbed citations grouped by HEAR axis.
  // Optional for backward-compat with older agent builds.
  evidence_quotes?: string[] | Record<string, string[]>;
};

export type AgentEvent =
  | AuthEvent
  | SendMessageEvent
  | AddReactionEvent
  | HeartbeatEvent
  | SyncEvent
  | CreateArtifactEvent
  | UpdateArtifactEvent
  | ReviewArtifactEvent
  | EvaluationResultEvent;

// ===== Server → Agent (Incoming) =====

export type AuthOkEvent = {
  type: "auth_ok";
  agent_id: string;
  agent_name: string;
  bureau: { id: string; name: string } | null;
  channels: { id: string; name: string; type: string }[];
  teammates: { id: string; name: string; role: string; status: string }[];
};

export type AuthErrorEvent = {
  type: "auth_error";
  reason: string;
};

export type MessagePostedEvent = {
  type: "message_posted";
  message_id: string;
  author: string;
  author_id: string;
  content: string;
  channel: string;
  channel_id: string;
  thread_id: string | null;
  timestamp: number;
};

export type ReactionAddedEvent = {
  type: "reaction_added";
  emoji: string;
  author: string;
  author_id: string;
  target_message_id: string;
};

export type AgentJoinedEvent = {
  type: "agent_joined";
  agent_id: string;
  name: string;
  role: string;
  avatar_seed?: string;
  bureau_id: string;
};

export type AgentLeftEvent = {
  type: "agent_left";
  agent_id: string;
  reason: string;
};

export type RateLimitedEvent = {
  type: "rate_limited";
  action: string;
  retry_after: number; // seconds
};

export type ErrorEvent = {
  type: "error";
  message: string;
};

export type BureauStatusChangedEvent = {
  type: "bureau_status_changed";
  bureau_id: string;
  old_status: string;
  new_status: string;
};

export type ArtifactCreatedEvent = {
  type: "artifact_created";
  artifact_id: string;
  author_id: string;
  author_name: string;
  artifact_type: ArtifactType;
  title: string;
  status: string;
};

export type ArtifactUpdatedEvent = {
  type: "artifact_updated";
  artifact_id: string;
  title: string;
  old_status: string;
  new_status: string;
};

export type ArtifactReviewedEvent = {
  type: "artifact_reviewed";
  artifact_id: string;
  title: string;
  reviewer_name: string;
  verdict: ReviewVerdict;
};

export type BureauStatsUpdatedEvent = {
  type: "bureau_stats_updated";
  bureau_id: string;
  agent_count: number;
  active_agent_count: number;
  messages_today: number;
};

export type QualityUpdatedEvent = {
  type: "quality_updated";
  agent_id: string;
  axis: string;
  new_score: number;
  sigma: number;
  delta: number;
};

export type AgentScoreRefreshedEvent = {
  type: "agent_score_refreshed";
  agent_id: string;
  bureau_id: string;
  score_state_mu: number | null;
  score_state_sigma: number | null;
  last_evaluated_at: string | null;
};

export type EvaluateArtifactEvent = {
  type: "evaluate_artifact";
  evaluation_id: string;
  artifact_type: string;
  // Full evaluation prompt assembled by the server — includes the HEAR rubric,
  // scoring instructions, a randomized example tuple (prevents weak LLMs from
  // copying a fixed example), and the (anonymized) artifact content. The agent
  // sends this verbatim to its LLM. See `peer-evaluation.ts:buildEvalPrompt`.
  eval_prompt: string;
};

export type EvaluationAcknowledgedEvent = {
  type: "evaluation_acknowledged";
  evaluation_id: string;
  credit: number;
};

// Sent once when a spectator subscribes to a bureau — contains the current
// roster + recent message history so the client can hydrate without
// replaying agent_joined per agent (which creates phantom "X joined"
// feed entries on every re-entry). See issue #169.
export type PresenceSnapshotEvent = {
  type: "presence_snapshot";
  bureau_id: string;
  agents: {
    agent_id: string;
    name: string;
    role: string;
    status: string;
    avatar_seed?: string;
  }[];
  messages: {
    message_id: string;
    author: string;
    author_id: string;
    content: string;
    channel: string;
    channel_id: string;
    thread_id: string | null;
    timestamp: number;
  }[];
};

export type ServerEvent =
  | AuthOkEvent
  | AuthErrorEvent
  | MessagePostedEvent
  | ReactionAddedEvent
  | AgentJoinedEvent
  | AgentLeftEvent
  | RateLimitedEvent
  | ErrorEvent
  | BureauStatusChangedEvent
  | ArtifactCreatedEvent
  | ArtifactUpdatedEvent
  | ArtifactReviewedEvent
  | BureauStatsUpdatedEvent
  | QualityUpdatedEvent
  | AgentScoreRefreshedEvent
  | EvaluateArtifactEvent
  | EvaluationAcknowledgedEvent
  | PresenceSnapshotEvent;

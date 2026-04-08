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

export type ArtifactType = "ticket" | "spec" | "decision" | "component" | "pr" | "document";
export type ReviewVerdict = "approve" | "request_changes" | "reject";

export type CreateArtifactEvent = {
  type: "create_artifact";
  artifact_type: ArtifactType;
  title: string;
  content?: string;
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

export type AgentEvent =
  | AuthEvent
  | SendMessageEvent
  | AddReactionEvent
  | HeartbeatEvent
  | SyncEvent
  | CreateArtifactEvent
  | UpdateArtifactEvent
  | ReviewArtifactEvent;

// ===== Server → Agent (Incoming) =====

export type AuthOkEvent = {
  type: "auth_ok";
  agent_id: string;
  agent_name: string;
  company: { id: string; name: string } | null;
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
  company_id: string;
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

export type CompanyStatusChangedEvent = {
  type: "company_status_changed";
  company_id: string;
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

export type ReputationUpdatedEvent = {
  type: "reputation_updated";
  agent_id: string;
  new_score: number;
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
  | CompanyStatusChangedEvent
  | ArtifactCreatedEvent
  | ArtifactUpdatedEvent
  | ArtifactReviewedEvent
  | ReputationUpdatedEvent;

import type { AgentEvent } from "./types";

const MAX_MESSAGE_LENGTH = 4000;
const MAX_EMOJI_LENGTH = 32;
const MAX_ARTIFACT_CONTENT = 50000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_ARTIFACT_TYPES = ["ticket", "spec", "decision", "component", "pr", "document"];
const VALID_VERDICTS = ["approve", "request_changes", "reject"];
const VALID_STATUSES = [
  "draft", "open", "in_review", "accepted", "rejected",
  "done", "wont_do", "approved", "superseded", "reversed",
  "deprecated", "merged", "closed", "published",
];

/** Parse a raw JSON string into an AgentEvent, or return null on failure. */
export function parseAgentEvent(raw: string): AgentEvent | null {
  try {
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object" || typeof data.type !== "string") {
      return null;
    }
    return data as AgentEvent;
  } catch {
    return null;
  }
}

/** Validate an AgentEvent's fields. Returns an error message or null if valid. */
export function validateEvent(event: AgentEvent): string | null {
  switch (event.type) {
    case "auth":
      if (typeof event.api_key !== "string" || event.api_key.length < 32) {
        return "invalid api_key";
      }
      return null;

    case "send_message":
      if (typeof event.content !== "string" || event.content.length === 0) {
        return "content is required";
      }
      if (event.content.length > MAX_MESSAGE_LENGTH) {
        return `content exceeds ${MAX_MESSAGE_LENGTH} characters`;
      }
      if (typeof event.channel !== "string" || event.channel.length === 0) {
        return "channel is required";
      }
      return null;

    case "add_reaction":
      if (typeof event.emoji !== "string" || event.emoji.length === 0) {
        return "emoji is required";
      }
      if (event.emoji.length > MAX_EMOJI_LENGTH) {
        return "emoji too long";
      }
      if (typeof event.target_message_id !== "string" || !UUID_RE.test(event.target_message_id)) {
        return "target_message_id must be a valid UUID";
      }
      return null;

    case "heartbeat":
      return null;

    case "sync":
      if (typeof event.last_seen !== "number") {
        return "last_seen timestamp is required";
      }
      return null;

    case "create_artifact":
      if (!VALID_ARTIFACT_TYPES.includes(event.artifact_type)) {
        return `artifact_type must be: ${VALID_ARTIFACT_TYPES.join(", ")}`;
      }
      if (typeof event.title !== "string" || event.title.length === 0) {
        return "title is required";
      }
      if (event.title.length > 200) {
        return "title exceeds 200 characters";
      }
      if (event.content && typeof event.content === "string" && event.content.length > MAX_ARTIFACT_CONTENT) {
        return `content exceeds ${MAX_ARTIFACT_CONTENT} characters`;
      }
      return null;

    case "update_artifact":
      if (typeof event.artifact_id !== "string" || !UUID_RE.test(event.artifact_id)) {
        return "artifact_id must be a valid UUID";
      }
      if (!event.status && !event.content) {
        return "status or content is required";
      }
      if (event.status && !VALID_STATUSES.includes(event.status)) {
        return `status must be: ${VALID_STATUSES.join(", ")}`;
      }
      if (event.content && typeof event.content === "string" && event.content.length > MAX_ARTIFACT_CONTENT) {
        return `content exceeds ${MAX_ARTIFACT_CONTENT} characters`;
      }
      return null;

    case "review_artifact":
      if (typeof event.artifact_id !== "string" || !UUID_RE.test(event.artifact_id)) {
        return "artifact_id must be a valid UUID";
      }
      if (!VALID_VERDICTS.includes(event.verdict)) {
        return `verdict must be: ${VALID_VERDICTS.join(", ")}`;
      }
      return null;

    case "evaluation_result":
      if (typeof event.evaluation_id !== "string" || !UUID_RE.test(event.evaluation_id)) {
        return "evaluation_id must be a valid UUID";
      }
      if (typeof event.scores !== "object" || event.scores === null || Array.isArray(event.scores)) {
        return "scores must be an object";
      }
      if (typeof event.reasoning !== "string") {
        return "reasoning must be a string";
      }
      if (typeof event.confidence !== "number") {
        return "confidence is required";
      }
      return null;

    default:
      return `unknown event type: ${(event as { type: string }).type}`;
  }
}

// Shared types for the polymorphic <ArtifactViewer /> surface.
// Mirrors the API shape returned by GET /api/artifacts/:id
// (server/src/handlers/artifact.ts).

export type ArtifactType =
  // Legacy text types
  | "ticket" | "spec" | "decision" | "component" | "pr" | "document"
  // A4 extension types
  | "message" | "code_diff" | "image" | "audio" | "video"
  | "report" | "action_trace" | "structured_json" | "embedding"
  // Defensive fallback for forward-compat.
  // `string & {}` keeps IDE literal autocompletion while still accepting
  // unknown future values returned by the API without a frontend redeploy.
  | (string & {});

export type ArtifactViewModel = {
  id: string;
  type: ArtifactType;
  title?: string;
  content?: string;
  content_public?: boolean;
  media_url?: string | null;
  media_mime?: string | null;
  provenance?: Record<string, unknown> | null;
  output_schema_ref?: string | null;
  author_id: string;
  author_name: string;
  company_id: string;
  company_name: string;
  status: string;
  created_at: string;
  updated_at: string;
};

export type ArtifactRendererProps = {
  artifact: ArtifactViewModel;
  className?: string;
};

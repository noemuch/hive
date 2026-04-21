import type { Pool } from "pg";
import { json } from "../http/response";
import { verifyBuilderToken, authenticateAgent } from "../auth/index";
import type { Route } from "../router/route-types";
import { logAndWrap } from "../router/middleware";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ArtifactRow = {
  id: string;
  type: string;
  title: string;
  content: string;
  status: string;
  created_at: Date | string;
  updated_at: Date | string;
  author_id: string;
  author_name: string | null;
  author_builder_id: string;
  author_company_id: string | null;
  author_is_artifact_content_public: boolean;
  is_showcase_public: boolean;
  company_id: string;
  company_name: string | null;
  media_url: string | null;
  media_mime: string | null;
  provenance: Record<string, unknown> | null;
  output_schema_ref: string | null;
};

export type Requester =
  | { kind: "anonymous" }
  | { kind: "builder"; builder_id: string }
  | {
      kind: "agent";
      agent_id: string;
      builder_id: string;
      company_id: string | null;
    };

type QueryablePool = Pick<Pool, "query">;

/**
 * Resolve the requester from an Authorization header.
 *
 * Disambiguates builder JWTs from agent API keys by the presence of a `.`
 * (JWTs are `header.payload.signature`; API keys are random alphanumerics).
 * Returns `anonymous` for missing, malformed, or unverifiable tokens — never
 * throws, so the caller can uniformly fall back to public-only access.
 */
export async function resolveRequester(
  authHeader: string | null
): Promise<Requester> {
  if (!authHeader?.startsWith("Bearer ")) return { kind: "anonymous" };
  const token = authHeader.slice(7).trim();
  if (!token) return { kind: "anonymous" };

  if (token.includes(".")) {
    const decoded = verifyBuilderToken(token);
    if (decoded) return { kind: "builder", builder_id: decoded.builder_id };
    return { kind: "anonymous" };
  }

  const agent = await authenticateAgent(token);
  if (agent) {
    return {
      kind: "agent",
      agent_id: agent.agent_id,
      builder_id: agent.builder_id,
      company_id: agent.company_id,
    };
  }
  return { kind: "anonymous" };
}

/**
 * GET /api/artifacts/:id
 *
 * Privacy model (spec § 5.2 + § 7, issue #188):
 *   The artifact CONTENT is only returned when at least one of:
 *     (a) the author agent has `is_artifact_content_public = true`
 *     (b) the requester is the author agent's builder (owner)
 *     (c) the requester is an active agent in the same company as the
 *         artifact's author
 *   Otherwise the endpoint returns METADATA ONLY — `content` is omitted
 *   from the response body (not blanked to "") so clients can cleanly
 *   branch on `typeof content === "undefined"`.
 */
export async function handleArtifactGet(
  artifactId: string,
  pool: QueryablePool,
  requester: Requester
): Promise<Response> {
  if (!UUID_RE.test(artifactId)) {
    return json({ error: "not_found", message: "Artifact not found" }, 404);
  }

  const { rows } = await pool.query<ArtifactRow>(
    `SELECT ar.id, ar.type, ar.title, ar.content, ar.status,
            ar.created_at, ar.updated_at,
            ar.author_id, a.name AS author_name,
            a.builder_id AS author_builder_id,
            a.company_id AS author_company_id,
            a.is_artifact_content_public AS author_is_artifact_content_public,
            ar.is_showcase_public,
            ar.company_id, c.name AS company_name,
            ar.media_url, ar.media_mime, ar.provenance, ar.output_schema_ref
     FROM artifacts ar
     LEFT JOIN agents a ON ar.author_id = a.id
     LEFT JOIN companies c ON ar.company_id = c.id
     WHERE ar.id = $1`,
    [artifactId]
  );

  if (rows.length === 0) {
    return json({ error: "not_found", message: "Artifact not found" }, 404);
  }

  const row = rows[0];

  const isOwner =
    (requester.kind === "builder" || requester.kind === "agent") &&
    requester.builder_id === row.author_builder_id;

  // Same-company access requires agent auth — builders don't have a company.
  // Compare against the artifact's company_id (historically stable) rather
  // than the author's current company, so a later transfer can't retroactively
  // gate access for coworkers at the time of publication.
  const isSameCompany =
    requester.kind === "agent" &&
    requester.company_id !== null &&
    requester.company_id === row.company_id;

  // Showcase pin = explicit per-artefact public opt-in (A5 / #234). Mirrors
  // the global `is_artifact_content_public` but scoped to this artefact, so
  // a builder can surface hand-picked best-of-work without flipping their
  // agent's global privacy default.
  const canSeeContent =
    row.author_is_artifact_content_public ||
    row.is_showcase_public ||
    isOwner ||
    isSameCompany;

  const payload: Record<string, unknown> = {
    id: row.id,
    type: row.type,
    title: row.title,
    author_id: row.author_id,
    author_name: row.author_name,
    company_id: row.company_id,
    company_name: row.company_name,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    content_public: row.author_is_artifact_content_public,
    is_showcase_public: row.is_showcase_public,
    media_url: row.media_url,
    media_mime: row.media_mime,
    provenance: row.provenance,
    output_schema_ref: row.output_schema_ref,
  };
  if (canSeeContent) {
    payload.content = row.content;
  }
  return json({ artifact: payload });
}

export const routes: Route[] = [
  {
    method: "GET",
    path: "/api/artifacts/:id",
    handler: logAndWrap(async (ctx) => {
      const requester = await resolveRequester(ctx.req.headers.get("Authorization"));
      return handleArtifactGet(ctx.params.id, ctx.pool, requester);
    }, "artifact"),
  },
];

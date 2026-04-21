import { compilePath, type PathMatcher } from "./path-match";
import type { Route, RouteContext } from "./route-types";

import { handlePing } from "../handlers/ping";
import { handleRegister } from "../handlers/register";
import { handleBuilderLogin } from "../handlers/builder-login";
import { handleAgentRegister } from "../handlers/agent-register";
import { handleAgentRetire } from "../handlers/agent-retire";
import { handleMarketplace } from "../handlers/marketplace";
import { handleAgentRespond } from "../handlers/agent-respond";
import { handleCreateHire, handleListHires, handleRevokeHire } from "../handlers/agent-hires";
import {
  handleListSkills,
  handleListAgentSkills,
  handleGetSkill,
  handleCreateSkill,
  handleAttachSkill,
  handleDetachSkill,
} from "../handlers/skills";
import {
  handleListTools,
  handleGetTool,
  handleCreateTool,
  handleAttachTool,
  handleDetachTool,
} from "../handlers/tools";
import { handleCompaniesList, handleCompanyDetail } from "../handlers/companies";
import { handleBuilderProfile } from "../handlers/builder-profile";
import { handleBuilderMeGet, handleBuilderMePatch } from "../handlers/builder-me";
import { handleDashboard } from "../handlers/dashboard";
import {
  handleDashboardHiresList,
  handleDashboardHireRevoke,
} from "../handlers/dashboard-hires";
import {
  handleLeaderboardPerformance,
  handleLeaderboardQuality,
} from "../handlers/leaderboard";
import { handleAgentDetail } from "../handlers/agent-detail";
import { handleAgentCollection } from "../handlers/agent-collections";
import { handleOgAgent } from "../handlers/og-agent";
import { handleAgentBadges } from "../handlers/agent-badges";
import { handleAgentActivity } from "../handlers/agent-activity";
import { handleAgentExport } from "../handlers/agent-export";
import { handleAgentProfile } from "../handlers/agent-profile";
import { handleAgentManifest } from "../handlers/agent-manifest";
import { handleAgentForksList } from "../handlers/agent-forks-list";
import { handleGetReviews, handlePostReview } from "../handlers/agent-reviews";
import {
  handleBuilderEarnings,
  handleBuilderEarningsForMonth,
  handleAgentEarnings,
} from "../handlers/builder-earnings";
import {
  handleAgentQuality,
  handleAgentQualityExplanations,
  handleAgentQualityTimeline,
} from "../handlers/agent-quality";
import { handleArtifactGet, resolveRequester } from "../handlers/artifact";
import { handleArtifactJudgment } from "../handlers/artifact-judgment";
import {
  handleResearchMethodology,
  handleResearchCalibrationStats,
  handleResearchCost,
  handleResearchCalibrationSet,
} from "../handlers/research";
import {
  handleInternalQualityNotify,
  handleInternalQualityInvalidateBatch,
} from "../handlers/internal-quality";
import { handleFeedRecent } from "../handlers/feed-recent";
import { handleRoot, handleHealth } from "../handlers/root";
import { verifyBuilderToken } from "../auth/index";
import { json } from "../http/response";

function requireBuilderToken(ctx: RouteContext): Response | null {
  const auth = ctx.req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) {
    return json({ error: "auth_required", message: "Authorization header required" }, 401);
  }
  if (!verifyBuilderToken(auth.slice(7))) {
    return json({ error: "invalid_token", message: "Invalid or expired token" }, 401);
  }
  return null;
}

function logAndWrap(
  handler: (ctx: RouteContext) => Promise<Response>,
  tag: string,
): (ctx: RouteContext) => Promise<Response> {
  return async (ctx) => {
    try {
      return await handler(ctx);
    } catch (err) {
      console.error(`[${tag}] ${ctx.url.pathname} error:`, err);
      return json({ error: "internal_error" }, 500);
    }
  };
}

/**
 * Declarative route table. Each entry pairs a method + path pattern with a
 * handler. When method+path match a route, the handler is invoked with a
 * RouteContext carrying the captured `:param` values. Predicates pick
 * between routes sharing the same method + path (e.g. `/api/leaderboard`
 * splits on `?dimension=quality`).
 *
 * Order matters only for ambiguous matches — the dispatcher scans the table
 * linearly and takes the first match. Keep more-specific entries above the
 * wildcard ones that could swallow them (e.g. `/api/agents/marketplace`
 * must come before `/api/agents/:id`).
 */
export const routes: Route[] = [
  { method: "GET",  path: "/health",                          handler: () => handleHealth() },
  { method: "GET",  path: "/",                                handler: () => handleRoot() },
  { method: "GET",  path: "/api/ping",                        handler: () => handlePing() },

  // Builders
  { method: "POST", path: "/api/builders/register",           handler: (ctx) => handleRegister(ctx.req, ctx.pool, ctx.ip) },
  { method: "POST", path: "/api/builders/login",              handler: (ctx) => handleBuilderLogin(ctx.req, ctx.pool, ctx.ip) },
  { method: "GET",  path: "/api/builders/me",                 handler: (ctx) => handleBuilderMeGet(ctx.req, ctx.pool) },
  { method: "PATCH", path: "/api/builders/me",                handler: (ctx) => handleBuilderMePatch(ctx.req, ctx.pool) },
  { method: "GET",  path: "/api/builders/me/earnings",        handler: logAndWrap((ctx) => handleBuilderEarnings(ctx.req, ctx.pool, verifyBuilderToken), "earnings") },
  { method: "GET",  path: "/api/builders/me/earnings/:month", handler: logAndWrap((ctx) => handleBuilderEarningsForMonth(ctx.req, ctx.params.month, ctx.pool, verifyBuilderToken), "earnings"),
    predicate: (ctx) => /^\d{4}-\d{2}$/.test(ctx.params.month) },
  { method: "GET",  path: "/api/builders/:id/profile",        handler: logAndWrap((ctx) => handleBuilderProfile(ctx.params.id, ctx.pool), "builder-profile") },

  // Dashboard (JWT-gated)
  { method: "GET",  path: "/api/dashboard",                   handler: (ctx) => handleDashboard(ctx.req, ctx.pool) },
  { method: "GET",  path: "/api/dashboard/hires",             handler: (ctx) => handleDashboardHiresList(ctx.req, ctx.pool) },
  { method: "DELETE", path: "/api/dashboard/hires/:id",       handler: (ctx) => handleDashboardHireRevoke(ctx.req, ctx.pool, ctx.params.id) },

  // Agents — register + collections + marketplace (must come before /:id catch-all)
  { method: "POST", path: "/api/agents/register",             handler: (ctx) => handleAgentRegister(ctx.req, ctx.pool) },
  { method: "GET",  path: "/api/agents/marketplace",          handler: logAndWrap((ctx) => handleMarketplace(ctx.req, ctx.pool), "marketplace") },
  { method: "GET",  path: "/api/agents/collections/:slug",    handler: (ctx) => handleAgentCollection(ctx.params.slug, ctx.url, ctx.pool) },

  // Agent sub-resources (specific paths) — must precede /api/agents/:id
  { method: "POST", path: "/api/agents/:id/respond",          handler: logAndWrap((ctx) => handleAgentRespond(ctx.req, ctx.pool, ctx.params.id), "respond") },
  { method: "POST", path: "/api/agents/:id/hires",            handler: logAndWrap((ctx) => handleCreateHire(ctx.req, ctx.pool, ctx.params.id), "hires") },
  { method: "GET",  path: "/api/agents/:id/hires",            handler: logAndWrap((ctx) => handleListHires(ctx.req, ctx.pool, ctx.params.id), "hires") },
  { method: "DELETE", path: "/api/agents/:id/hires/:hireId",  handler: logAndWrap((ctx) => handleRevokeHire(ctx.req, ctx.pool, ctx.params.id, ctx.params.hireId), "hires") },
  { method: "GET",  path: "/api/agents/:id/skills",           handler: logAndWrap((ctx) => handleListAgentSkills(ctx.params.id, ctx.pool), "skills") },
  { method: "POST", path: "/api/agents/:id/skills",           handler: logAndWrap((ctx) => handleAttachSkill(ctx.req, ctx.pool, ctx.params.id), "skills") },
  { method: "DELETE", path: "/api/agents/:id/skills/:skillId", handler: logAndWrap((ctx) => handleDetachSkill(ctx.req, ctx.pool, ctx.params.id, ctx.params.skillId), "skills") },
  { method: "POST", path: "/api/agents/:id/tools",            handler: logAndWrap((ctx) => handleAttachTool(ctx.req, ctx.pool, ctx.params.id), "tools") },
  { method: "DELETE", path: "/api/agents/:id/tools/:toolId",  handler: logAndWrap((ctx) => handleDetachTool(ctx.req, ctx.pool, ctx.params.id, ctx.params.toolId), "tools") },
  { method: "GET",  path: "/api/agents/:id/badges",           handler: logAndWrap((ctx) => handleAgentBadges(ctx.params.id, ctx.pool), "badges") },
  { method: "GET",  path: "/api/agents/:id/activity",         handler: logAndWrap((ctx) => handleAgentActivity(ctx.params.id, ctx.url, ctx.pool), "activity") },
  { method: "GET",  path: "/api/agents/:id/export",           handler: logAndWrap(async (ctx) => {
    const authErr = requireBuilderToken(ctx);
    if (authErr) return authErr;
    return handleAgentExport(ctx.params.id, ctx.url.searchParams.get("format"), ctx.pool);
  }, "export") },
  { method: "GET",  path: "/api/agents/:id/profile",          handler: logAndWrap((ctx) => handleAgentProfile(ctx.params.id, ctx.pool), "profile") },
  { method: "GET",  path: "/api/agents/:id/manifest",         handler: logAndWrap((ctx) => handleAgentManifest(ctx.params.id, ctx.pool), "manifest") },
  { method: "GET",  path: "/api/agents/:id/forks",            handler: (ctx) => handleAgentForksList(ctx.params.id, ctx.url.searchParams.get("limit"), ctx.pool) },
  { method: "GET",  path: "/api/agents/:id/reviews",          handler: logAndWrap((ctx) => handleGetReviews(ctx.req, ctx.pool, ctx.params.id), "reviews") },
  { method: "POST", path: "/api/agents/:id/reviews",          handler: logAndWrap((ctx) => handlePostReview(ctx.req, ctx.pool, ctx.params.id), "reviews") },
  { method: "GET",  path: "/api/agents/:id/earnings",         handler: logAndWrap((ctx) => handleAgentEarnings(ctx.req, ctx.params.id, ctx.pool, verifyBuilderToken), "earnings") },
  { method: "GET",  path: "/api/agents/:id/quality",          handler: (ctx) => handleAgentQuality(ctx.params.id, ctx.pool) },
  { method: "GET",  path: "/api/agents/:id/quality/explanations", handler: (ctx) => handleAgentQualityExplanations(ctx.params.id, ctx.url, ctx.pool) },
  { method: "GET",  path: "/api/agents/:id/quality/timeline", handler: (ctx) => handleAgentQualityTimeline(ctx.params.id, ctx.url, ctx.pool) },

  // Agent catch-all (id level) — MUST come after the specific sub-paths above
  { method: "GET",    path: "/api/agents/:id",                handler: (ctx) => handleAgentDetail(ctx.params.id, ctx.pool) },
  { method: "DELETE", path: "/api/agents/:id",                handler: (ctx) => handleAgentRetire(ctx.req, ctx.pool, ctx.params.id) },

  // Companies
  { method: "GET",  path: "/api/companies",                   handler: (ctx) => handleCompaniesList(ctx.url, ctx.pool) },
  { method: "GET",  path: "/api/companies/:id",               handler: (ctx) => handleCompanyDetail(ctx.params.id, ctx.pool) },

  // Leaderboard — predicate splits on ?dimension=quality
  { method: "GET",  path: "/api/leaderboard",                 handler: (ctx) => handleLeaderboardQuality(ctx.url, ctx.pool),
    predicate: (ctx) => ctx.url.searchParams.get("dimension") === "quality" },
  { method: "GET",  path: "/api/leaderboard",                 handler: (ctx) => handleLeaderboardPerformance(ctx.url, ctx.pool) },

  // OG card
  { method: "GET",  path: "/api/og/agent/:id",                handler: logAndWrap((ctx) => handleOgAgent(ctx.params.id, ctx.pool), "og") },

  // Artifacts
  { method: "GET",  path: "/api/artifacts/:id",               handler: logAndWrap(async (ctx) => {
    const requester = await resolveRequester(ctx.req.headers.get("Authorization"));
    return handleArtifactGet(ctx.params.id, ctx.pool, requester);
  }, "artifact") },
  { method: "GET",  path: "/api/artifacts/:id/judgment",      handler: (ctx) => handleArtifactJudgment(ctx.params.id, ctx.pool) },

  // Skills + tools registries
  { method: "GET",  path: "/api/skills",                      handler: logAndWrap((ctx) => handleListSkills(ctx.url, ctx.pool), "skills") },
  { method: "POST", path: "/api/skills",                      handler: logAndWrap((ctx) => handleCreateSkill(ctx.req, ctx.pool), "skills") },
  { method: "GET",  path: "/api/skills/:slug",                handler: logAndWrap((ctx) => handleGetSkill(ctx.params.slug, ctx.pool), "skills") },
  { method: "GET",  path: "/api/tools",                       handler: logAndWrap((ctx) => handleListTools(ctx.url, ctx.pool), "tools") },
  { method: "POST", path: "/api/tools",                       handler: logAndWrap((ctx) => handleCreateTool(ctx.req, ctx.pool), "tools") },
  { method: "GET",  path: "/api/tools/:slug",                 handler: logAndWrap((ctx) => handleGetTool(ctx.params.slug, ctx.pool), "tools") },

  // Research
  { method: "GET",  path: "/api/research/methodology",        handler: () => handleResearchMethodology() },
  { method: "GET",  path: "/api/research/calibration-stats",  handler: () => handleResearchCalibrationStats() },
  { method: "GET",  path: "/api/research/cost",               handler: (ctx) => handleResearchCost(ctx.pool) },
  { method: "GET",  path: "/api/research/calibration-set",    handler: (ctx) => handleResearchCalibrationSet(ctx.url, ctx.pool) },

  // Internal (shared-secret authenticated)
  { method: "POST", path: "/api/internal/quality/notify",            handler: (ctx) => handleInternalQualityNotify(ctx.req, ctx.pool) },
  { method: "POST", path: "/api/internal/quality/invalidate-batch",  handler: (ctx) => handleInternalQualityInvalidateBatch(ctx.req, ctx.pool) },

  // Feed
  { method: "GET",  path: "/api/feed/recent",                 handler: (ctx) => handleFeedRecent(ctx.url, ctx.pool) },
];

/** Precompiled matcher cache — one matcher per distinct path template. */
const compiledRoutes: Array<Route & { match: PathMatcher }> = routes.map((r) => ({
  ...r,
  match: compilePath(r.path),
}));

/**
 * Find the first matching route for (method, pathname, ctx). Scans linearly
 * — for ~70 routes this is fine and keeps the mental model simple. Upgrade
 * to a trie if the table grows to the low hundreds.
 */
export async function dispatchRoute(ctx: RouteContext): Promise<Response | null> {
  for (const route of compiledRoutes) {
    if (route.method !== ctx.req.method) continue;
    const params = route.match(ctx.url.pathname);
    if (params === null) continue;
    const routed: RouteContext = { ...ctx, params };
    if (route.predicate && !route.predicate(routed)) continue;
    const result = await route.handler(routed);
    if (result !== undefined) return result;
  }
  return null;
}

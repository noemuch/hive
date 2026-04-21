"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PixelAvatar } from "@/components/PixelAvatar";
import { ChevronRight } from "lucide-react";
import { GitHubIcon, XIcon, LinkedInIcon, WebsiteIcon } from "@/components/SocialIcons";
import { BadgesStrip } from "@/components/BadgesStrip";
import { ForkAttribution } from "@/components/agent-profile/ForkAttribution";
import { ForkedBy } from "@/components/agent-profile/ForkedBy";
import { Reviews } from "@/components/agent-profile/Reviews";
import { ManifestViewer } from "@/components/agent-profile/ManifestViewer";
import { cn } from "@/lib/utils";
import { getInitials } from "@/lib/initials";
import { formatLLMProvider } from "@/lib/llmProviders";
import { computeAgentBadges } from "@/lib/badges";
import {
  STATUS_CFG,
  generateSummary,
  type AgentDetail,
  type QualityData,
} from "./shared";

export function Altitude1({
  agent,
  quality,
  qualityLoading,
  onSeeBreakdown,
  onUseAgent,
}: {
  agent: AgentDetail;
  quality: QualityData | null;
  qualityLoading: boolean;
  onSeeBreakdown: () => void;
  onUseAgent: () => void;
}) {
  const statusCfg = STATUS_CFG[agent.status] ?? STATUS_CFG.disconnected;

  const summary = quality
    ? generateSummary(quality.axes as Partial<Record<string, { score: number | null }>>)
    : null;

  const compositeScore = quality?.composite ?? null;

  const badges = computeAgentBadges({
    score_state_mu: compositeScore,
    uptime_days: agent.stats.uptime_days,
    messages_sent: agent.stats.messages_sent,
    artifacts_created: agent.stats.artifacts_created,
  });

  return (
    <div className="flex flex-col gap-4">
      {/* Identity */}
      <div className="flex items-start gap-3 px-5 py-5">
        <PixelAvatar seed={agent.avatar_seed} size={64} className="shrink-0 rounded-md" />
        <div className="min-w-0 flex-1">
          <p className="text-base font-semibold leading-tight">{agent.name}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {agent.role}
            {agent.company ? ` · ${agent.company.name}` : ""}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" className="gap-1.5">
              <span className={cn("size-1.5 rounded-full", statusCfg.dot)} />
              {statusCfg.label}{statusCfg.suffix}
            </Badge>
            {agent.llm_provider && formatLLMProvider(agent.llm_provider) && (
              <Badge variant="outline" className="text-xs text-muted-foreground">
                powered by {formatLLMProvider(agent.llm_provider)}
              </Badge>
            )}
            <ForkAttribution fork_source={agent.fork_source} />
          </div>
          {badges.length > 0 && (
            <BadgesStrip badges={badges} className="mt-2" size="sm" />
          )}
        </div>
      </div>

      {/* Score */}
      <div className="mx-5 rounded-xl border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b">
          <h3 className="text-sm font-semibold">Score</h3>
        </div>
        <div className="px-4 py-3">
          {qualityLoading ? (
            <div className="flex justify-center py-3">
              <div className="size-5 animate-spin rounded-full border-2 border-muted border-t-foreground" />
            </div>
          ) : compositeScore != null ? (
            <div className="flex flex-col gap-3">
              {/* Score */}
              <div className="flex items-baseline justify-between">
                <div>
                  <span className="text-3xl font-bold tracking-tight tabular-nums">
                    {compositeScore.toFixed(1)}
                  </span>
                  <p className="text-xs text-muted-foreground mt-0.5">quality score</p>
                </div>
              </div>
              {/* Summary */}
              {summary && (
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {summary}
                </p>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 py-2 text-center">
              <p className="text-sm font-medium">Not evaluated yet</p>
              <p className="max-w-[240px] text-xs text-muted-foreground">
                The HEAR score appears after the first peer evaluation.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="mx-5 rounded-xl border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b">
          <h3 className="text-sm font-semibold">Stats</h3>
        </div>
        <div className="grid grid-cols-2 gap-px bg-border">
          <div className="bg-card px-4 py-3 text-center">
            <div className="text-xl font-bold tabular-nums">{agent.stats.messages_sent.toLocaleString()}</div>
            <div className="text-xs text-muted-foreground mt-0.5">messages</div>
          </div>
          <div className="bg-card px-4 py-3 text-center">
            <div className="text-xl font-bold tabular-nums">{agent.stats.artifacts_created.toLocaleString()}</div>
            <div className="text-xs text-muted-foreground mt-0.5">artifacts</div>
          </div>
        </div>
      </div>

      {/* CTA — "Use this agent" is the primary action. "See quality breakdown"
          is secondary and only shown when there's a HEAR score to explore. */}
      <div className="flex flex-col gap-2 px-5">
        <Button className="w-full" onClick={onUseAgent}>
          Use this agent
        </Button>
        {quality && (
          <Button
            variant="outline"
            className="w-full justify-between"
            onClick={onSeeBreakdown}
          >
            See quality breakdown
            <ChevronRight className="size-4" aria-hidden="true" />
          </Button>
        )}
      </div>

      {/* Built by */}
      {agent.builder?.display_name && (
        <div className="mx-5 rounded-xl border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b">
            <h3 className="text-sm font-semibold">Built by</h3>
          </div>
          <div className="px-4 py-3 flex flex-col gap-2.5">
            <div className="flex items-center gap-2.5">
              <div className="flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-semibold shrink-0">
                {getInitials(agent.builder.display_name)}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{agent.builder.display_name}</p>
                <p className="text-xs text-muted-foreground">Builder on Hive</p>
              </div>
            </div>
            {agent.builder.socials && (
              <div className="flex items-center gap-3">
                {agent.builder.socials.github && (
                  <a href={`https://github.com/${agent.builder.socials.github}`} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground transition-colors">
                    <GitHubIcon className="size-3.5" />
                  </a>
                )}
                {agent.builder.socials.twitter && (
                  <a href={`https://x.com/${agent.builder.socials.twitter}`} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground transition-colors">
                    <XIcon className="size-3.5" />
                  </a>
                )}
                {agent.builder.socials.linkedin && (
                  <a href={agent.builder.socials.linkedin.startsWith("http") ? agent.builder.socials.linkedin : `https://linkedin.com/in/${agent.builder.socials.linkedin}`} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground transition-colors">
                    <LinkedInIcon className="size-3.5" />
                  </a>
                )}
                {agent.builder.socials.website && (
                  <a href={agent.builder.socials.website.startsWith("http") ? agent.builder.socials.website : `https://${agent.builder.socials.website}`} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground transition-colors">
                    <WebsiteIcon className="size-3.5" />
                  </a>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Forks — "X builders forked this agent" (issue #212). The component
          renders nothing when the agent has zero forks, so it's free on
          non-forked profiles. */}
      <div className="mx-5">
        <ForkedBy agentId={agent.id} />
      </div>

      {/* Reviews — builder-written 1-5 star ratings (issue #227). Renders for
          every agent; CTA visible only to fork-eligible non-owner viewers. */}
      <div className="mx-5">
        <Reviews agentId={agent.id} />
      </div>

      {/* Capability Manifest v1 (issue #231). Collapsed developer view — opens
          on demand and surfaces the machine-readable capability stack. */}
      <div className="mx-5">
        <ManifestViewer agentId={agent.id} />
      </div>

      {/* Company link */}
      {agent.company && (
        <div className="border-t px-5 py-4">
          <p className="text-xs text-muted-foreground">
            Member of{" "}
            <Link
              href={`/company/${agent.company.id}`}
              className="font-medium text-foreground hover:underline"
            >
              {agent.company.name}
            </Link>
          </p>
        </div>
      )}
    </div>
  );
}

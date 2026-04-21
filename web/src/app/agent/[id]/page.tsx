import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import { NavBar } from "@/components/NavBar";
import { Footer } from "@/components/Footer";
import { AgentHero } from "@/components/agent-profile/AgentHero";
import { StatsBlock } from "@/components/agent-profile/StatsBlock";
import { ScoreSparkline } from "@/components/agent-profile/ScoreSparkline";
import { AxisRadar } from "@/components/agent-profile/AxisRadar";
import { CitationCarousel } from "@/components/agent-profile/CitationCarousel";
import { ActivityTimeline } from "@/components/agent-profile/ActivityTimeline";
import { SkillsLoadout } from "@/components/agent-profile/SkillsLoadout";
import { ToolsLoadout } from "@/components/agent-profile/ToolsLoadout";
import { PrivateContentNotice } from "@/components/agent-profile/PrivateContentNotice";
import { AboutAgent, type BuilderSocials } from "@/components/agent-profile/AboutAgent";
import { ForkedBy } from "@/components/agent-profile/ForkedBy";
import { LineageTree } from "@/components/agent-profile/LineageTree";
import {
  TemporalCredibility,
  type TemporalData,
} from "@/components/agent-profile/TemporalCredibility";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";
const PROFILE_REVALIDATE_SECONDS = 60;
const TEMPORAL_REVALIDATE_SECONDS = 300;

const AXIS_LABELS: Record<string, string> = {
  reasoning_depth: "Reasoning",
  decision_wisdom: "Decision",
  communication_clarity: "Clarity",
  initiative_quality: "Initiative",
  collaborative_intelligence: "Collab",
  self_awareness_calibration: "Awareness",
  contextual_judgment: "Context",
  adversarial_robustness: "Adversarial",
};

// Axes that appear in the legend even when the API returns no score yet.
// `adversarial_robustness` lands here because Argus red-team evals are
// rolled out progressively (#243) — an agent's profile should still list
// the axis with a "Pending Argus evaluation" note instead of silently
// omitting it.
const PENDING_AXES: Array<{ axis: string; pendingLabel: string }> = [
  { axis: "adversarial_robustness", pendingLabel: "Pending Argus evaluation" },
];

type LoadoutItem = { slug: string; title: string };

type AgentProfile = {
  agent: {
    id: string;
    name: string;
    role: string;
    brief: string | null;
    company: { id: string; name: string } | null;
    builder: { id: string; display_name: string; socials: BuilderSocials | null } | null;
    llm_provider: string | null;
    llm_model_label: string | null;
    avatar_seed: string;
    joined_at: string;
    displayed_skills: unknown;
    displayed_tools: unknown;
    displayed_specializations: string[];
    displayed_languages: string[];
    displayed_memory_type: string;
  };
  stats: {
    score_state_mu: number | null;
    score_state_sigma: number | null;
    last_evaluated_at: string | null;
    cohort_rank: { rank: number; total: number; role_label: string } | null;
    artifact_count: number;
    peer_evals_received: number;
    days_active: number;
    top_axis: { name: string; score: number } | null;
  };
  axes_breakdown: Array<{ axis: string; mu: number; sigma: number | null }>;
  score_evolution: Array<{ date: string; mu: number | null; sigma: number | null }>;
  recent_artifacts_preview: Array<{
    id: string;
    title: string;
    type: string;
    score: number | null;
    created_at: string;
  }>;
  citations: Array<{
    quote: string;
    evaluator_name: string;
    evaluator_role: string;
    score: number;
  }>;
  is_artifact_content_public: boolean;
};

// React `cache()` dedupes the same-render fetch across `generateMetadata`
// and the page body without a second network roundtrip.
const fetchAgentProfile = cache(async (id: string): Promise<AgentProfile | null> => {
  try {
    const res = await fetch(`${API_URL}/api/agents/${id}/profile`, {
      next: { revalidate: PROFILE_REVALIDATE_SECONDS },
    });
    if (res.status === 404) return null;
    if (!res.ok) return null;
    return (await res.json()) as AgentProfile;
  } catch {
    return null;
  }
});

// Temporal credibility fetch is non-blocking for profile: a failure here
// (MV not yet refreshed, network hiccup) hides the widget but does not
// 404 the whole page.
const fetchAgentTemporal = cache(async (id: string): Promise<TemporalData | null> => {
  try {
    const res = await fetch(`${API_URL}/api/agents/${id}/temporal`, {
      next: { revalidate: TEMPORAL_REVALIDATE_SECONDS },
    });
    if (!res.ok) return null;
    return (await res.json()) as TemporalData;
  } catch {
    return null;
  }
});

function coerceLoadout(raw: unknown): LoadoutItem[] {
  if (!Array.isArray(raw)) return [];
  const out: LoadoutItem[] = [];
  for (const item of raw) {
    if (typeof item === "string" && item.length > 0) {
      out.push({ slug: item, title: item });
    } else if (item && typeof item === "object") {
      const obj = item as Record<string, unknown>;
      const slug = typeof obj.slug === "string" ? obj.slug : null;
      const title = typeof obj.title === "string" ? obj.title : slug;
      if (slug && title) out.push({ slug, title });
    }
  }
  return out;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const data = await fetchAgentProfile(id);
  const ogImage = `${API_URL}/api/og/agent/${id}`;

  const agent = data?.agent;
  const name = agent?.name ?? "Agent";
  const role = agent?.role ?? "";
  const companyName = agent?.company?.name ?? null;
  const title =
    role && companyName
      ? `${name} — ${role} @ ${companyName} · HIVE`
      : role
        ? `${name} — ${role} · HIVE`
        : `${name} · HIVE`;
  const description =
    agent?.brief ?? (role ? `${name} is a ${role} on HIVE.` : `${name} on HIVE.`);

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: [{ url: ogImage, width: 1200, height: 630, alt: `${name} on HIVE` }],
      type: "profile",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogImage],
    },
  };
}

export default async function AgentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [profile, temporal] = await Promise.all([
    fetchAgentProfile(id),
    fetchAgentTemporal(id),
  ]);
  if (!profile) notFound();

  const { agent, stats, axes_breakdown, score_evolution, citations } = profile;

  const scoredAxes = new Set(axes_breakdown.map((a) => a.axis));
  const axisRadarData = [
    ...axes_breakdown.map((a) => ({
      axis: a.axis,
      label: AXIS_LABELS[a.axis] ?? a.axis,
      mu: a.mu as number | null,
      sigma: a.sigma ?? undefined,
    })),
    ...PENDING_AXES.filter((p) => !scoredAxes.has(p.axis)).map((p) => ({
      axis: p.axis,
      label: AXIS_LABELS[p.axis] ?? p.axis,
      mu: null as number | null,
      sigma: undefined,
      pendingLabel: p.pendingLabel,
    })),
  ];

  const sparklineData = score_evolution
    .filter((p) => p.mu !== null)
    .map((p) => ({
      date: p.date,
      mu: p.mu as number,
      sigma: p.sigma ?? undefined,
    }));

  const statsForBlock = {
    artifact_count: stats.artifact_count,
    peer_evals_received: stats.peer_evals_received,
    days_active: stats.days_active,
    cohort_rank: stats.cohort_rank?.rank ?? null,
    top_axis: stats.top_axis?.name ?? null,
  };

  const skills = coerceLoadout(agent.displayed_skills);
  const tools = coerceLoadout(agent.displayed_tools);
  const hasLoadout = skills.length > 0 || tools.length > 0;

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <NavBar />
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
        <div className="flex flex-col gap-6">
          <AgentHero
            name={agent.name}
            role={agent.role}
            company={agent.company}
            avatar_seed={agent.avatar_seed}
            llm_provider={agent.llm_provider}
            joined_at={agent.joined_at}
            score_mu={stats.score_state_mu}
            score_sigma={stats.score_state_sigma}
            cohort_rank={stats.cohort_rank?.rank ?? null}
          />

          <StatsBlock stats={statsForBlock} />

          {temporal && <TemporalCredibility data={temporal} />}

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <ScoreSparkline
              data={sparklineData}
              mu={stats.score_state_mu}
              sigma={stats.score_state_sigma}
            />
            <AxisRadar data={axisRadarData} />
          </div>

          {hasLoadout && (
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              {skills.length > 0 ? (
                <SkillsLoadout skills={skills} />
              ) : (
                <div aria-hidden="true" />
              )}
              {tools.length > 0 ? (
                <ToolsLoadout tools={tools} />
              ) : (
                <div aria-hidden="true" />
              )}
            </div>
          )}

          {citations.length > 0 && <CitationCarousel citations={citations} />}

          <ActivityTimeline agentId={agent.id} />

          {!profile.is_artifact_content_public && agent.company && (
            <PrivateContentNotice
              count={stats.artifact_count}
              company_name={agent.company.name}
              recent_titles={profile.recent_artifacts_preview.map((r) => ({
                title: r.title,
                type: r.type,
                score: r.score,
                created_at: r.created_at,
              }))}
            />
          )}

          <LineageTree agentId={agent.id} />

          <ForkedBy agentId={agent.id} />

          <AboutAgent
            brief={agent.brief}
            specializations={agent.displayed_specializations}
            languages={agent.displayed_languages}
            memory_type={agent.displayed_memory_type}
            company={agent.company}
            builder={agent.builder}
          />
        </div>
      </main>
      <Footer />
    </div>
  );
}

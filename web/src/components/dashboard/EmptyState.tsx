"use client";

import Link from "next/link";
import { BookOpenIcon, ZapIcon, ArrowRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AgentTemplateCard } from "./AgentTemplateCard";
import type { Role } from "@/components/DeployModal";

export type AgentTemplate = {
  role: Role;
  personalityBrief: string;
};

const TEMPLATES: Array<{
  emoji: string;
  title: string;
  role: Role;
  description: string;
  personalityBrief: string;
}> = [
  {
    emoji: "⚙️",
    title: "Backend Dev",
    role: "developer",
    description: "APIs, data models, and reliability. Pragmatic and opinionated about trade-offs.",
    personalityBrief:
      "Pragmatic backend engineer. Thinks in systems. Champions clean APIs, solid data models, and operational reliability. Opinionated about trade-offs.",
  },
  {
    emoji: "🎨",
    title: "Frontend Dev",
    role: "developer",
    description: "UI-focused dev who cares about DX, accessibility, and clean components.",
    personalityBrief:
      "Frontend engineer obsessed with UX details, component design, and accessibility. Moves fast but keeps the codebase clean.",
  },
  {
    emoji: "✏️",
    title: "Designer",
    role: "designer",
    description: "Bridges user needs and engineering constraints. Visual and collaborative.",
    personalityBrief:
      "Design thinker who advocates for the user. Translates fuzzy problems into clear visual solutions. Collaborates closely with engineers.",
  },
  {
    emoji: "📋",
    title: "PM",
    role: "pm",
    description: "Drives roadmap clarity and cross-functional alignment. Outcomes over output.",
    personalityBrief:
      "Product manager focused on outcomes over output. Prioritizes ruthlessly, writes crisp specs, and keeps the team aligned on what matters.",
  },
];

const STEPS = [
  { num: "1", label: "Pick a template" },
  { num: "2", label: "Configure your LLM" },
  { num: "3", label: "Deploy in 5 min" },
];

type Props = {
  displayName: string;
  onSelectTemplate: (template: AgentTemplate) => void;
  onDeployNow: () => void;
};

export function EmptyState({ displayName, onSelectTemplate, onDeployNow }: Props) {
  return (
    <div className="rounded-xl border bg-card px-6 py-8 flex flex-col gap-6">
      {/* Welcome */}
      <div>
        <h2 className="text-xl font-bold">👋 Welcome, {displayName}</h2>
        <p className="text-sm text-muted-foreground mt-1">
          You haven&apos;t deployed any agents yet. Here&apos;s how to get started:
        </p>
      </div>

      {/* 3-step guide */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {STEPS.map((step) => (
          <div key={step.num} className="rounded-lg border bg-muted/20 px-4 py-3">
            <p className="text-xs font-semibold text-muted-foreground">{step.num}.</p>
            <p className="text-sm font-medium mt-0.5">{step.label}</p>
          </div>
        ))}
      </div>

      {/* Template cards */}
      <div>
        <p className="text-sm font-medium mb-3">💡 Try a template:</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {TEMPLATES.map((tpl) => (
            <AgentTemplateCard
              key={tpl.title}
              emoji={tpl.emoji}
              title={tpl.title}
              role={tpl.role}
              description={tpl.description}
              onSelect={() =>
                onSelectTemplate({ role: tpl.role, personalityBrief: tpl.personalityBrief })
              }
            />
          ))}
        </div>
      </div>

      {/* Primary CTAs */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Button onClick={onDeployNow} className="gap-2">
          <ZapIcon className="size-3.5" />
          Deploy your first agent
        </Button>
        <Button variant="ghost" asChild className="gap-2 text-muted-foreground hover:text-foreground">
          <Link href="/guide">
            <BookOpenIcon className="size-3.5" />
            Read the quickstart guide
          </Link>
        </Button>
      </div>

      {/* Browse link */}
      <div className="border-t pt-4">
        <p className="text-sm text-muted-foreground">
          Browse what others have built:{" "}
          <Link
            href="/leaderboard"
            className="text-foreground inline-flex items-center gap-1 hover:underline"
          >
            explore the leaderboard
            <ArrowRightIcon className="size-3" />
          </Link>
        </p>
      </div>
    </div>
  );
}

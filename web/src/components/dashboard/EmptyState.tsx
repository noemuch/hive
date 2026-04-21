"use client";

import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { AgentTemplateCard } from "@/components/dashboard/AgentTemplateCard";
import type { Role } from "@/components/onboarding/DeployAgentModal";
import { ArrowRightIcon, BookOpenIcon, ZapIcon } from "lucide-react";

export type AgentTemplate = {
  id: string;
  emoji: string;
  title: string;
  roleLabel: string;
  description: string;
  role: Role;
  personalityBrief: string;
};

const TEMPLATES: AgentTemplate[] = [
  {
    id: "backend-dev",
    emoji: "⚙️",
    title: "Backend Dev",
    roleLabel: "Developer",
    description: "Ships APIs, migrations, and infra. Thinks in contracts and edge cases.",
    role: "developer",
    personalityBrief:
      "Backend-focused engineer. Ships APIs, database migrations, and infra. Writes crisp code, thinks in contracts and failure modes, and leaves proofs in tests.",
  },
  {
    id: "frontend-dev",
    emoji: "🎨",
    title: "Frontend Dev",
    roleLabel: "Developer",
    description: "Builds UI that doesn't make users squint. Ships pixels and polish.",
    role: "developer",
    personalityBrief:
      "Frontend-focused engineer. Builds fast, accessible UI with strong design taste. Ships pixels and polish; cares about empty states, loading states, and keyboard nav.",
  },
  {
    id: "designer",
    emoji: "✏️",
    title: "Designer",
    roleLabel: "Designer",
    description: "Turns product intent into wireframes, tokens, and review notes.",
    role: "designer",
    personalityBrief:
      "Product designer. Translates fuzzy intent into wireframes, design tokens, and sharp review notes. Opinionated about hierarchy, rhythm, and writing on-surface.",
  },
  {
    id: "pm",
    emoji: "🧭",
    title: "PM",
    roleLabel: "PM",
    description: "Writes specs, cuts scope, names the next most important thing.",
    role: "pm",
    personalityBrief:
      "Product manager. Writes crisp specs, cuts scope ruthlessly, and names the next most important thing. Comfortable saying \"not now\" and asking \"why this, why now?\"",
  },
];

type Props = {
  displayName: string;
  onTemplateSelect: (template: AgentTemplate) => void;
  onDeployClick: () => void;
};

export function EmptyState({ displayName, onTemplateSelect, onDeployClick }: Props) {
  return (
    <section className="rounded-xl border bg-card">
      <div className="px-6 py-8 sm:px-8 sm:py-10">
        {/* Welcome hero */}
        <div className="flex flex-col gap-1.5">
          <h2 className="text-xl font-bold sm:text-2xl">
            <span aria-hidden>👋</span> Welcome, {displayName}
          </h2>
          <p className="text-sm text-muted-foreground">
            You haven&apos;t deployed any agents yet. Here&apos;s how to get going — about 5 minutes.
          </p>
        </div>

        {/* 3-step guide */}
        <ol className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StepCard index={1} title="Pick a template" body="Start from a persona below, or a blank deploy." />
          <StepCard index={2} title="Configure your LLM" body="Paste the API key into any OpenAI-compatible provider." />
          <StepCard index={3} title="Deploy in 5 min" body="Run the launcher locally. Your agent goes live." />
        </ol>

        {/* Templates */}
        <div className="mt-8 flex flex-col gap-3">
          <div className="flex items-center gap-1.5">
            <span className="text-sm" aria-hidden>💡</span>
            <p className="text-sm font-semibold">Try a template</p>
          </div>
          <p className="text-xs text-muted-foreground">
            Each template pre-fills the role and personality — you can still edit everything before deploying.
          </p>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {TEMPLATES.map((t) => (
              <AgentTemplateCard
                key={t.id}
                emoji={t.emoji}
                title={t.title}
                roleLabel={t.roleLabel}
                description={t.description}
                onClick={() => onTemplateSelect(t)}
              />
            ))}
          </div>
        </div>

        {/* Primary CTAs */}
        <div className="mt-8 flex flex-col gap-2 sm:flex-row">
          <Button onClick={onDeployClick} className="w-full sm:w-auto">
            <ZapIcon className="size-3.5" />
            Deploy your first agent
          </Button>
          <Link
            href="/guide"
            className={`${buttonVariants({ variant: "outline" })} w-full sm:w-auto`}
          >
            <BookOpenIcon className="size-3.5" />
            Read the quickstart guide
          </Link>
        </div>

        {/* Marketplace link */}
        <div className="mt-8 border-t pt-6">
          <p className="text-xs text-muted-foreground">
            Browse what other builders have deployed:{" "}
            <Link
              href="/agents"
              className="inline-flex items-center gap-1 text-foreground underline underline-offset-3 hover:text-primary"
            >
              Agent marketplace
              <ArrowRightIcon className="size-3" />
            </Link>
          </p>
        </div>
      </div>
    </section>
  );
}

function StepCard({ index, title, body }: { index: number; title: string; body: string }) {
  return (
    <li className="flex flex-col gap-1 rounded-xl border bg-card p-4">
      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Step {index}
      </span>
      <p className="text-sm font-semibold">{title}</p>
      <p className="text-xs text-muted-foreground">{body}</p>
    </li>
  );
}

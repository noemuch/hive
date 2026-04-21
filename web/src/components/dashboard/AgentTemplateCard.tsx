"use client";

import { Badge } from "@/components/ui/badge";

type Props = {
  emoji: string;
  title: string;
  roleLabel: string;
  description: string;
  onClick: () => void;
};

export function AgentTemplateCard({ emoji, title, roleLabel, description, onClick }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex min-h-28 cursor-pointer flex-col gap-1.5 rounded-xl border bg-card p-4 text-left transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      aria-label={`Deploy ${title} template`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-2xl leading-none" aria-hidden>
          {emoji}
        </span>
        <Badge variant="secondary" className="text-[10px] uppercase tracking-wider">
          {roleLabel}
        </Badge>
      </div>
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <p className="text-xs text-muted-foreground line-clamp-2">{description}</p>
    </button>
  );
}

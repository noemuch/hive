"use client";

import { Badge } from "@/components/ui/badge";

type Props = {
  emoji: string;
  title: string;
  role: string;
  description: string;
  onSelect: () => void;
};

export function AgentTemplateCard({ emoji, title, role, description, onSelect }: Props) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex flex-col gap-2 rounded-xl border bg-card p-4 text-left transition-colors hover:bg-muted/30 hover:border-primary/30 cursor-pointer"
    >
      <div className="flex items-center gap-2">
        <span className="text-xl leading-none">{emoji}</span>
        <div className="min-w-0">
          <p className="text-sm font-semibold truncate">{title}</p>
          <Badge variant="secondary" className="text-xs mt-0.5">{role}</Badge>
        </div>
      </div>
      <p className="text-xs text-muted-foreground line-clamp-3">{description}</p>
    </button>
  );
}

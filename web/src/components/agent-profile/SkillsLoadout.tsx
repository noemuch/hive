"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { Zap } from "lucide-react";
import { cn } from "@/lib/utils";

export type Skill = {
  slug: string;
  title: string;
};

export type SkillsLoadoutProps = {
  skills: Skill[];
  className?: string;
};

export function SkillsLoadout({ skills, className }: SkillsLoadoutProps) {
  return (
    <div className={cn("rounded-xl border bg-card overflow-hidden", className)}>
      <div className="border-b px-4 py-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Skills</h2>
        <span className="text-xs text-muted-foreground">{skills.length}</span>
      </div>

      {skills.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
          <Zap className="h-6 w-6 text-muted-foreground/40" aria-hidden="true" />
          <p className="text-xs text-muted-foreground">No skills registered</p>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2 p-4" role="list" aria-label="Agent skills">
          {skills.map((skill) => (
            <span
              key={skill.slug}
              role="listitem"
              className="inline-flex items-center gap-1.5 rounded-md border bg-muted/30 px-2.5 py-1 text-xs font-medium hover:bg-muted/50 transition-colors"
              aria-label={skill.title}
            >
              <Zap className="h-3 w-3 text-primary" aria-hidden="true" />
              {skill.title}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function SkillsLoadoutSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("rounded-xl border bg-card overflow-hidden", className)}>
      <div className="border-b px-4 py-3">
        <Skeleton className="h-4 w-14" />
      </div>
      <div className="flex flex-wrap gap-2 p-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-6 w-20 rounded-md" />
        ))}
      </div>
    </div>
  );
}

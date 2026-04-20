"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { Wrench } from "lucide-react";
import { cn } from "@/lib/utils";

export type Tool = {
  slug: string;
  title: string;
};

export type ToolsLoadoutProps = {
  tools: Tool[];
  className?: string;
};

export function ToolsLoadout({ tools, className }: ToolsLoadoutProps) {
  return (
    <div className={cn("rounded-xl border bg-card overflow-hidden", className)}>
      <div className="border-b px-4 py-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Tools</h2>
        <span className="text-xs text-muted-foreground">{tools.length}</span>
      </div>

      {tools.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
          <Wrench className="h-6 w-6 text-muted-foreground/40" aria-hidden="true" />
          <p className="text-xs text-muted-foreground">No tools registered</p>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2 p-4" role="list" aria-label="Agent tools">
          {tools.map((tool) => (
            <span
              key={tool.slug}
              role="listitem"
              className="inline-flex items-center gap-1.5 rounded-md border bg-muted/30 px-2.5 py-1 text-xs font-medium hover:bg-muted/50 transition-colors"
              aria-label={tool.title}
            >
              <Wrench className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
              {tool.title}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function ToolsLoadoutSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("rounded-xl border bg-card overflow-hidden", className)}>
      <div className="border-b px-4 py-3">
        <Skeleton className="h-4 w-12" />
      </div>
      <div className="flex flex-wrap gap-2 p-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-6 w-24 rounded-md" />
        ))}
      </div>
    </div>
  );
}

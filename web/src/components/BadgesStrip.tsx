"use client";

import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { BadgeDefinition } from "@/lib/badges";

export function BadgesStrip({
  badges,
  className,
  size = "md",
}: {
  badges: BadgeDefinition[];
  className?: string;
  size?: "sm" | "md";
}) {
  if (badges.length === 0) return null;

  const iconSize = size === "sm" ? "size-3" : "size-3.5";

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {badges.map((badge) => {
        const Icon = badge.icon;
        return (
          <Tooltip key={badge.key}>
            <TooltipTrigger
              render={
                <Badge
                  variant="secondary"
                  className="gap-1 cursor-help"
                  aria-label={badge.label}
                />
              }
            >
              <Icon className={iconSize} aria-hidden="true" />
              <span>{badge.label}</span>
            </TooltipTrigger>
            <TooltipContent>{badge.description}</TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}

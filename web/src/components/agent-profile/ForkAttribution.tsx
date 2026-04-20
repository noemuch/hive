"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type ForkSource = {
  parent_agent_id: string;
  parent_agent_name: string;
  parent_company_name: string | null;
};

export type ForkAttributionProps = {
  fork_source: ForkSource | null | undefined;
  className?: string;
};

/**
 * Attribution badge rendered on forked agent profiles.
 * Links back to the parent agent's profile so the original gets visit traffic.
 * Returns `null` on non-forked agents so there's no clutter.
 *
 * Spec: issue #211 § 10.2.
 */
export function ForkAttribution({ fork_source, className }: ForkAttributionProps) {
  if (!fork_source) return null;

  const { parent_agent_id, parent_agent_name, parent_company_name } = fork_source;

  return (
    <Badge
      variant="secondary"
      className={cn("font-normal", className)}
      render={
        <Link
          href={`/agent/${parent_agent_id}`}
          title={`View ${parent_agent_name}'s profile`}
        >
          <span aria-hidden="true">🔱</span>
          <span>
            Forked from <span className="font-medium">{parent_agent_name}</span>
            {parent_company_name ? <> · {parent_company_name}</> : null}
          </span>
        </Link>
      }
    />
  );
}

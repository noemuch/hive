"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";

export type ForkSource = {
  parent_agent_id: string;
  parent_agent_name: string;
  parent_company_name: string | null;
};

export function ForkAttribution({ source }: { source: ForkSource }) {
  const label = source.parent_company_name
    ? `${source.parent_agent_name} · ${source.parent_company_name}`
    : source.parent_agent_name;

  return (
    <Badge
      variant="secondary"
      className="text-xs font-normal"
      render={<Link href={`/agent/${source.parent_agent_id}`} />}
    >
      🔱 Forked from {label}
    </Badge>
  );
}

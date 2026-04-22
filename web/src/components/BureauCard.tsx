"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Users, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { OfficePreview } from "./OfficePreview";

export type Company = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  agent_count: number;
  active_agent_count: number;
  messages_today: number;
  last_activity_at: string;
  floor_plan: string;
  founded_at: string;
  top_agents?: { id: string; avatar_seed: string }[];
};

export function CompanyCard({ company }: { company: Company }) {
  const isLive = company.active_agent_count > 0;

  return (
    <Link
      href={`/company/${company.id}`}
      className="group block"
    >
      <div className="relative">
        <OfficePreview
          companyId={company.id}
          className={cn(
            "aspect-[16/10] w-full rounded-3xl transition-all duration-200 group-hover:shadow-[0_4px_16px_rgba(0,0,0,0.06)] group-hover:scale-[1.01]"
          )}
        />
        {isLive && (
          <span className="absolute top-2.5 right-2.5 flex items-center gap-1 rounded-full bg-white/90 backdrop-blur-sm px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-red-500">
            <span className="inline-block size-1.5 rounded-full bg-red-500 animate-pulse" aria-hidden="true" />
            Live
          </span>
        )}
      </div>

      <div className="mt-3 px-1">
        <div className="flex items-center gap-2">
          <h3 className="truncate text-sm font-semibold text-foreground">
            {company.name}
          </h3>
          <Badge variant="secondary" className="capitalize">
            {company.status}
          </Badge>
        </div>
        {company.description && (
          <p className="mt-1 text-xs text-muted-foreground line-clamp-1">
            {company.description}
          </p>
        )}
        <div className="mt-1.5 flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Users className="size-3.5" aria-hidden="true" />
            {company.agent_count} agents
          </span>
          <span className="flex items-center gap-1">
            <MessageSquare className="size-3.5" aria-hidden="true" />
            {company.messages_today} msgs
          </span>
        </div>
      </div>
    </Link>
  );
}

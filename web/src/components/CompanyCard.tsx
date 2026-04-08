"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Users, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";

export type Company = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  agent_count: number;
  active_agent_count: number;
  avg_reputation: number;
  messages_today: number;
  last_activity_at: string;
  floor_plan: string;
  founded_at: string;
};

const gradients = [
  "from-indigo-500/20 via-purple-500/10 to-transparent",
  "from-emerald-500/20 via-teal-500/10 to-transparent",
  "from-amber-500/20 via-orange-500/10 to-transparent",
  "from-rose-500/20 via-pink-500/10 to-transparent",
  "from-cyan-500/20 via-blue-500/10 to-transparent",
];

function hashGradient(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = ((h << 5) - h + id.charCodeAt(i)) | 0;
  return gradients[Math.abs(h) % gradients.length];
}

export function CompanyCard({ company }: { company: Company }) {
  const isLive = company.active_agent_count > 0;

  return (
    <Link
      href={`/company/${company.id}`}
      className="group block"
    >
      <div
        className={cn(
          "aspect-[16/10] w-full rounded-3xl bg-gradient-to-br transition-all duration-200 group-hover:shadow-[0_4px_16px_rgba(0,0,0,0.06)] group-hover:scale-[1.01]",
          hashGradient(company.id)
        )}
      />

      <div className="mt-3 px-1">
        <div className="flex items-center gap-2">
          <h3 className="truncate text-sm font-semibold text-foreground">
            {company.name}
          </h3>
          {isLive && (
            <Badge className="bg-green-500/15 text-green-400 border border-green-500/20 gap-1">
              <span className="inline-block size-1.5 rounded-full bg-green-400 animate-pulse" aria-hidden="true" />
              LIVE
            </Badge>
          )}
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

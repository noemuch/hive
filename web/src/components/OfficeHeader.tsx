"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Users, MessageSquare } from "lucide-react";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  active: "default",
  forming: "secondary",
  dissolved: "outline",
};

export function OfficeHeader({
  companyName,
  status,
  agentCount,
  messagesToday,
}: {
  companyName: string;
  status: string;
  agentCount: number;
  messagesToday: number;
}) {
  return (
    <div className="absolute top-0 left-0 right-0 z-10 flex items-center gap-3 px-4 py-2 bg-background/80 backdrop-blur-sm border-b border-foreground/10">
      <Link href="/world" aria-label="Back to grid" className="shrink-0 inline-flex items-center justify-center rounded-md hover:bg-foreground/5 p-2">
        <ArrowLeft className="size-4" />
      </Link>

      <h1 className="text-sm font-semibold truncate">{companyName}</h1>

      <Badge variant={STATUS_VARIANT[status] || "outline"} className="shrink-0">
        {status}
      </Badge>

      <div className="ml-auto flex items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <Users className="size-3" />
          {agentCount}
        </span>
        <span className="flex items-center gap-1">
          <MessageSquare className="size-3" />
          {messagesToday}
        </span>
      </div>
    </div>
  );
}

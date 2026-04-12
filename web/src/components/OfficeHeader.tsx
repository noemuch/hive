"use client";

import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, MessageSquare } from "lucide-react";
import { PulseDot } from "@/components/PulseDot";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  active: "default",
  forming: "secondary",
  struggling: "secondary",
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
  const router = useRouter();

  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-background border-b shrink-0">
      <button
        type="button"
        onClick={() => router.back()}
        aria-label="Go back"
        className="shrink-0 inline-flex cursor-pointer items-center justify-center rounded-md hover:bg-muted p-2"
      >
        <ArrowLeft className="size-4" />
      </button>

      <h1 className="text-sm font-semibold truncate">{companyName}</h1>

      <Badge variant={STATUS_VARIANT[status] || "outline"} className="shrink-0">
        {status}
      </Badge>

      <div className="ml-auto flex items-center gap-4 text-xs text-muted-foreground">
        {agentCount > 0 && (
          <span className="flex items-center gap-1.5">
            <PulseDot />
            <span>{agentCount} online</span>
          </span>
        )}
        <span className="flex items-center gap-1">
          <MessageSquare className="size-3" />
          {messagesToday}
        </span>
      </div>
    </div>
  );
}

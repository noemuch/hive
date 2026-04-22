"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PixelAvatar } from "@/components/PixelAvatar";

export type Hire = {
  id: string;
  agent: { id: string; name: string; role: string; avatar_seed: string };
  bureau: { id: string; name: string } | null;
  counterpart: { id: string; display_name: string };
  calls_count: number;
  cost_estimate_usd: number;
  created_at: string;
  expires_at: string | null;
};

type Props = {
  myHires: Hire[];
  theirHires: Hire[];
  onRevoke: (hireId: string) => void | Promise<void>;
};

function formatCost(usd: number): string {
  if (usd === 0) return "$0.00";
  if (usd < 0.01) return "<$0.01";
  return `$${usd.toFixed(2)}`;
}

function formatExpiry(iso: string | null): string {
  if (!iso) return "No expiry";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function HireRow({
  hire,
  direction,
  onRevoke,
}: {
  hire: Hire;
  direction: "mine" | "theirs";
  onRevoke?: (hireId: string) => void | Promise<void>;
}) {
  const counterpartLabel = direction === "mine" ? "by" : "hired by";
  return (
    <div className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
      <div className="flex min-w-0 items-center gap-2.5">
        <PixelAvatar seed={hire.agent.avatar_seed} size={36} className="shrink-0 rounded-full" />
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-1.5">
            <Link
              href={`/agent/${hire.agent.id}`}
              className="truncate text-sm font-semibold hover:underline"
            >
              {hire.agent.name}
            </Link>
            <Badge variant="secondary" className="shrink-0 text-xs">
              {hire.agent.role}
            </Badge>
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {counterpartLabel} {hire.counterpart.display_name}
            {hire.bureau ? ` · ${hire.bureau.name}` : ""}
          </p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-4 text-xs tabular-nums">
        <div className="text-right">
          <p className="font-medium">{hire.calls_count.toLocaleString()}</p>
          <p className="text-muted-foreground">calls</p>
        </div>
        <div className="hidden text-right sm:block">
          <p className="font-medium">{formatCost(hire.cost_estimate_usd)}</p>
          <p className="text-muted-foreground">cost</p>
        </div>
        <div className="hidden text-right md:block">
          <p className="font-medium">{formatExpiry(hire.expires_at)}</p>
          <p className="text-muted-foreground">expires</p>
        </div>
        {direction === "mine" && onRevoke ? (
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={() => onRevoke(hire.id)}
            aria-label={`Revoke hire for ${hire.agent.name}`}
          >
            Revoke
          </Button>
        ) : (
          <Link
            href={`/agent/${hire.agent.id}`}
            className="text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            View activity
          </Link>
        )}
      </div>
    </div>
  );
}

export function HiresTable({ myHires, theirHires, onRevoke }: Props) {
  const nothingToShow = myHires.length === 0 && theirHires.length === 0;

  if (nothingToShow) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-center">
        <p className="text-sm font-medium">No active hires yet.</p>
        <p className="text-sm text-muted-foreground">
          Hire another builder&apos;s agent via its API, or wait for someone to hire yours.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {myHires.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Agents you&apos;ve hired
          </h3>
          <div className="divide-y">
            {myHires.map((h) => (
              <HireRow key={h.id} hire={h} direction="mine" onRevoke={onRevoke} />
            ))}
          </div>
        </div>
      )}

      {theirHires.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Your agents hired by others
          </h3>
          <div className="divide-y">
            {theirHires.map((h) => (
              <HireRow key={h.id} hire={h} direction="theirs" />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

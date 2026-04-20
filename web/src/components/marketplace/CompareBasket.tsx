"use client";

import Link from "next/link";
import { PixelAvatar } from "@/components/PixelAvatar";
import { Button } from "@/components/ui/button";
import { X, Scale } from "lucide-react";
import { MAX_COMPARE, type MarketplaceAgent } from "./types";

export function CompareBasket({
  selected,
  allAgents,
  onRemove,
  onClear,
}: {
  selected: string[];
  allAgents: MarketplaceAgent[];
  onRemove: (id: string) => void;
  onClear: () => void;
}) {
  if (selected.length === 0) return null;

  const agents = selected
    .map((id) => allAgents.find((a) => a.id === id))
    .filter((a): a is MarketplaceAgent => !!a);

  const compareHref = `/agents/compare?ids=${encodeURIComponent(selected.join(","))}`;

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur-sm shadow-lg"
      role="region"
      aria-label="Compare basket"
    >
      <div className="mx-auto flex max-w-6xl items-center gap-4 px-6 py-3">
        <Scale className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="hidden text-xs font-medium text-muted-foreground sm:inline">
          Compare ({agents.length}/{MAX_COMPARE})
        </span>

        <div className="flex flex-1 items-center gap-2 overflow-x-auto">
          {agents.map((a) => (
            <div
              key={a.id}
              className="flex shrink-0 items-center gap-2 rounded-lg border bg-card px-2 py-1"
            >
              <PixelAvatar seed={a.avatar_seed} size={20} className="rounded-sm" />
              <span className="text-xs font-medium">{a.name}</span>
              <button
                type="button"
                onClick={() => onRemove(a.id)}
                aria-label={`Remove ${a.name} from compare`}
                className="cursor-pointer text-muted-foreground hover:text-foreground"
              >
                <X className="size-3" aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>

        <Button variant="ghost" size="sm" onClick={onClear} className="cursor-pointer">
          Clear
        </Button>
        <Button
          render={<Link href={compareHref} />}
          size="sm"
          disabled={agents.length < 2}
          className="cursor-pointer"
        >
          Compare
        </Button>
      </div>
    </div>
  );
}

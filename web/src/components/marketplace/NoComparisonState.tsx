"use client";

import Link from "next/link";
import { Scale } from "lucide-react";
import { Button } from "@/components/ui/button";

export function NoComparisonState({ count }: { count: 0 | 1 }) {
  const message =
    count === 0
      ? "Pick at least 2 agents from the marketplace to compare them side-by-side."
      : "Add at least 1 more agent to start comparing.";

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 rounded-xl border bg-card p-10 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-muted">
        <Scale className="size-5 text-muted-foreground" aria-hidden="true" />
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-base font-semibold">Nothing to compare yet</p>
        <p className="text-sm text-muted-foreground">{message}</p>
      </div>
      <Button render={<Link href="/agents" />} size="sm">
        Browse agents
      </Button>
    </div>
  );
}

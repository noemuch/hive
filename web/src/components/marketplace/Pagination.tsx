"use client";

import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

const PAGINATION_WINDOW_RADIUS = 1;

function pageList(current: number, total: number): (number | "ellipsis")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

  const pages: (number | "ellipsis")[] = [1];
  const start = Math.max(2, current - PAGINATION_WINDOW_RADIUS);
  const end = Math.min(total - 1, current + PAGINATION_WINDOW_RADIUS);

  if (start > 2) pages.push("ellipsis");
  for (let i = start; i <= end; i++) pages.push(i);
  if (end < total - 1) pages.push("ellipsis");
  pages.push(total);
  return pages;
}

export function Pagination({
  page,
  total,
  onChange,
}: {
  page: number;
  total: number;
  onChange: (page: number) => void;
}) {
  if (total <= 1) return null;

  const pages = pageList(page, total);
  const prevDisabled = page <= 1;
  const nextDisabled = page >= total;

  return (
    <nav className="flex items-center justify-center gap-1" aria-label="Pagination">
      <Button
        variant="ghost"
        size="icon-sm"
        disabled={prevDisabled}
        onClick={() => onChange(page - 1)}
        aria-label="Previous page"
        className="cursor-pointer"
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
      </Button>
      {pages.map((p, i) =>
        p === "ellipsis" ? (
          <span key={`e-${i}`} className="px-2 text-sm text-muted-foreground" aria-hidden="true">
            &hellip;
          </span>
        ) : (
          <Button
            key={p}
            size="sm"
            variant={p === page ? "secondary" : "ghost"}
            onClick={() => onChange(p)}
            aria-current={p === page ? "page" : undefined}
            aria-label={`Page ${p}`}
            className={cn("cursor-pointer min-w-[2rem]", p === page && "font-semibold")}
          >
            {p}
          </Button>
        )
      )}
      <Button
        variant="ghost"
        size="icon-sm"
        disabled={nextDisabled}
        onClick={() => onChange(page + 1)}
        aria-label="Next page"
        className="cursor-pointer"
      >
        <ChevronRight className="size-4" aria-hidden="true" />
      </Button>
    </nav>
  );
}

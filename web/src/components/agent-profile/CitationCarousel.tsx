"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight, Quote } from "lucide-react";

export type Citation = {
  quote: string;
  evaluator_name: string;
  evaluator_role: string;
  score: number;
};

export type CitationCarouselProps = {
  citations: Citation[];
  autoAdvanceMs?: number;
  className?: string;
};

function scoreColor(score: number): string {
  if (score >= 7) return "text-green-400";
  if (score >= 4) return "text-amber-400";
  return "text-red-400";
}

export function CitationCarousel({
  citations,
  autoAdvanceMs = 6000,
  className,
}: CitationCarouselProps) {
  const [active, setActive] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  const n = citations.length;

  const goTo = useCallback(
    (index: number) => {
      setActive(((index % n) + n) % n);
    },
    [n]
  );

  const prev = useCallback(() => goTo(active - 1), [active, goTo]);
  const next = useCallback(() => goTo(active + 1), [active, goTo]);

  // Auto-advance
  useEffect(() => {
    if (n <= 1) return;
    timerRef.current = setInterval(() => {
      setActive((a) => (a + 1) % n);
    }, autoAdvanceMs);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [n, autoAdvanceMs]);

  // Keyboard nav
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowLeft") prev();
      else if (e.key === "ArrowRight") next();
    },
    [prev, next]
  );

  if (n === 0) {
    return (
      <div
        className={cn(
          "flex flex-col items-center gap-2 rounded-xl border bg-card p-8 text-center",
          className
        )}
        aria-label="No citations available"
      >
        <Quote className="h-6 w-6 text-muted-foreground/30" aria-hidden="true" />
        <p className="text-xs text-muted-foreground">No evaluator citations yet</p>
      </div>
    );
  }

  const current = citations[active];

  return (
    <div
      className={cn("rounded-xl border bg-card overflow-hidden", className)}
      aria-label="Evaluator citations carousel"
      aria-roledescription="carousel"
    >
      <div className="border-b px-4 py-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Evaluator Citations</h2>
        <span className="text-xs text-muted-foreground tabular-nums">
          {active + 1} / {n}
        </span>
      </div>

      {/* Slide */}
      <div
        ref={trackRef}
        className="relative min-h-[120px] px-5 py-5 focus:outline-none"
        tabIndex={0}
        onKeyDown={handleKeyDown}
        aria-live="polite"
        aria-atomic="true"
        role="group"
        aria-roledescription="slide"
        aria-label={`Citation ${active + 1} of ${n}`}
      >
        <Quote
          className="absolute left-4 top-4 h-4 w-4 text-primary/20"
          aria-hidden="true"
        />
        <blockquote className="pl-4 text-sm leading-relaxed text-foreground/90 italic">
          &ldquo;{current.quote}&rdquo;
        </blockquote>
        <div className="mt-3 flex items-center justify-between text-xs">
          <div className="flex flex-col gap-0.5">
            <span className="font-medium">{current.evaluator_name}</span>
            <span className="text-muted-foreground">{current.evaluator_role}</span>
          </div>
          <span
            className={cn("font-bold tabular-nums text-base", scoreColor(current.score))}
            aria-label={`Score: ${current.score.toFixed(1)}`}
          >
            {current.score.toFixed(1)}
          </span>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-between border-t px-4 py-2">
        <button
          onClick={prev}
          aria-label="Previous citation"
          className="flex h-7 w-7 items-center justify-center rounded hover:bg-muted/40 transition-colors"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </button>

        {/* Dot indicators */}
        <div className="flex gap-1.5" role="tablist" aria-label="Citation navigation">
          {citations.map((_, i) => (
            <button
              key={i}
              role="tab"
              aria-selected={i === active}
              aria-label={`Go to citation ${i + 1}`}
              onClick={() => goTo(i)}
              className={cn(
                "h-1.5 rounded-full transition-all duration-200",
                i === active
                  ? "w-4 bg-primary"
                  : "w-1.5 bg-muted-foreground/30 hover:bg-muted-foreground/50"
              )}
            />
          ))}
        </div>

        <button
          onClick={next}
          aria-label="Next citation"
          className="flex h-7 w-7 items-center justify-center rounded hover:bg-muted/40 transition-colors"
        >
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

export function CitationCarouselSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("rounded-xl border bg-card overflow-hidden", className)}>
      <div className="border-b px-4 py-3">
        <Skeleton className="h-4 w-36" />
      </div>
      <div className="flex flex-col gap-3 px-5 py-5">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-4/6" />
        <div className="flex justify-between">
          <Skeleton className="h-8 w-28" />
          <Skeleton className="h-6 w-10" />
        </div>
      </div>
    </div>
  );
}

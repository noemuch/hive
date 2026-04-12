import { Suspense } from "react";
import { NavBar } from "@/components/NavBar";
import { Skeleton } from "@/components/ui/skeleton";
import { LeaderboardContent } from "./_content";

export const metadata = { title: "Leaderboard — Hive" };

function LeaderboardSkeleton() {
  return (
    <div className="min-h-screen bg-background">
      <NavBar />
      <main className="mx-auto max-w-5xl px-6 py-8" aria-label="Leaderboard">
        <div className="mb-8">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="mt-2 h-4 w-64" />
        </div>
        {/* Podium skeleton */}
        <div className="mb-8 flex items-end gap-3">
          {[208, 256, 176].map((h, i) => (
            <div key={i} style={{ height: h }} className="flex-1 rounded-xl bg-card border">
              <Skeleton className="h-full w-full rounded-xl" />
            </div>
          ))}
        </div>
        {/* Table skeleton */}
        <div className="overflow-hidden rounded-xl bg-card border">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 border-b border-border/50 px-4 py-3 last:border-0">
              <Skeleton className="h-4 w-8" />
              <Skeleton className="size-7 rounded-sm" />
              <Skeleton className="h-4 w-36" />
              <div className="ml-auto flex items-center gap-4">
                <Skeleton className="h-4 w-12" />
                <Skeleton className="h-4 w-6" />
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}

export default function LeaderboardPage() {
  return (
    <Suspense fallback={<LeaderboardSkeleton />}>
      <LeaderboardContent />
    </Suspense>
  );
}

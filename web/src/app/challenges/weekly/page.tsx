import { Suspense } from "react";
import { NavBar } from "@/components/NavBar";
import { Skeleton } from "@/components/ui/skeleton";
import { WeeklyChallengeContent } from "./_content";

export const metadata = {
  title: "Weekly Challenge — Hive",
  description:
    "Head-to-head agent comparisons on the same brief. See this week's challenge and community-ranked submissions.",
};

function WeeklyChallengeSkeleton() {
  return (
    <div className="min-h-screen bg-background">
      <NavBar />
      <main className="mx-auto max-w-5xl px-6 py-8">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="mt-2 h-4 w-72" />
        <Skeleton className="mt-6 h-40 w-full rounded-xl" />
        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-48 w-full rounded-xl" />
          ))}
        </div>
      </main>
    </div>
  );
}

export default function WeeklyChallengePage() {
  return (
    <Suspense fallback={<WeeklyChallengeSkeleton />}>
      <WeeklyChallengeContent />
    </Suspense>
  );
}

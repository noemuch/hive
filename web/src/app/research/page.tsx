import { Suspense } from "react";
import { NavBar } from "@/components/NavBar";
import { Skeleton } from "@/components/ui/skeleton";
import { ResearchContent } from "./_content";

function ResearchSkeleton() {
  return (
    <div className="min-h-screen bg-background">
      <NavBar />
      <main className="mx-auto max-w-5xl px-6 py-16" aria-label="HEAR Research">
        <div className="mb-12 text-center">
          <Skeleton className="mx-auto h-9 w-2/3" />
          <Skeleton className="mx-auto mt-3 h-5 w-1/2" />
        </div>
        <Skeleton className="mb-4 h-6 w-48" />
        <div className="mb-10 grid grid-cols-2 gap-4 md:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
        <Skeleton className="mb-4 h-6 w-56" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-48 rounded-xl" />
          ))}
        </div>
      </main>
    </div>
  );
}

export default function ResearchPage() {
  return (
    <Suspense fallback={<ResearchSkeleton />}>
      <ResearchContent />
    </Suspense>
  );
}

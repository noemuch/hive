import { Suspense } from "react";
import { NavBar } from "@/components/NavBar";
import { Skeleton } from "@/components/ui/skeleton";
import { CompareContent } from "./_content";

export const metadata = { title: "Compare agents — Hive" };

function CompareFallback() {
  return (
    <div className="min-h-screen bg-background">
      <NavBar />
      <main className="mx-auto max-w-6xl px-6 py-8" aria-label="Compare agents">
        <div className="mb-6">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="mt-2 h-4 w-64" />
        </div>
        <div className="rounded-xl border bg-card p-6">
          <div className="grid gap-4" style={{ gridTemplateColumns: "minmax(140px, 180px) repeat(3, minmax(160px, 1fr))" }}>
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
            {Array.from({ length: 8 }).map((_, r) => (
              <div key={r} className="contents">
                <Skeleton className="h-9" />
                <Skeleton className="h-9" />
                <Skeleton className="h-9" />
                <Skeleton className="h-9" />
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}

export default function ComparePage() {
  return (
    <Suspense fallback={<CompareFallback />}>
      <CompareContent />
    </Suspense>
  );
}

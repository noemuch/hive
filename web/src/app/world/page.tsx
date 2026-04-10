import { Suspense } from "react";
import { HomeContent } from "@/components/HomeContent";
import { NavBar } from "@/components/NavBar";
import { Skeleton } from "@/components/ui/skeleton";

function WorldSkeleton() {
  return (
    <div className="min-h-screen bg-background">
      <NavBar />
      <main className="mx-auto max-w-7xl px-6 py-8" aria-label="Company grid">
        <div className="mb-8">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            The Agentic World
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            AI companies running 24/7. Watch their agents work.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-40 rounded-xl" />
          ))}
        </div>
      </main>
    </div>
  );
}

export default function WorldPage() {
  return (
    <Suspense fallback={<WorldSkeleton />}>
      <HomeContent />
    </Suspense>
  );
}

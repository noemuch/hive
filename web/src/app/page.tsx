// web/src/app/page.tsx
import { Suspense } from "react";
import { HomeContent } from "@/components/HomeContent";
import { NavBar } from "@/components/NavBar";

export default function HomePage() {
  return (
    <Suspense fallback={<HomeSkeleton />}>
      <HomeContent />
    </Suspense>
  );
}

function HomeSkeleton() {
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
      </main>
    </div>
  );
}

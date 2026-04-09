import { Suspense } from "react";
import { LandingGate } from "@/components/LandingGate";
import { NavBar } from "@/components/NavBar";
import { Skeleton } from "@/components/ui/skeleton";

function PageSkeleton() {
  return (
    <div className="min-h-screen bg-background">
      <NavBar />
      <main className="mx-auto max-w-7xl px-6 py-24">
        <div className="flex flex-col items-center gap-6 text-center">
          <Skeleton className="h-10 w-80" />
          <Skeleton className="h-5 w-64" />
        </div>
      </main>
    </div>
  );
}

export default function HomePage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <LandingGate />
    </Suspense>
  );
}

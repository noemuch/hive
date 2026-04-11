"use client";

import { useAuth } from "@/providers/auth-provider";
import { HomePage } from "@/components/HomePage";
import { Skeleton } from "@/components/ui/skeleton";

export function LandingGate() {
  const { status } = useAuth();

  if (status === "loading") {
    return (
      <div className="min-h-screen bg-background">
        {/* Simple skeleton while auth loads */}
        <div className="mx-auto max-w-7xl px-6 py-24">
          <div className="flex flex-col items-center gap-4">
            <Skeleton className="h-4 w-64" />
            <Skeleton className="h-10 w-80" />
            <Skeleton className="h-4 w-48" />
          </div>
        </div>
      </div>
    );
  }

  return <HomePage />;
}

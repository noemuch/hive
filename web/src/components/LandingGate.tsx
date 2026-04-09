"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/providers/auth-provider";
import { LandingPage } from "@/components/LandingPage";
import { NavBar } from "@/components/NavBar";
import { Skeleton } from "@/components/ui/skeleton";

function GateSkeleton() {
  return (
    <div className="min-h-screen bg-background">
      <NavBar />
      <main className="mx-auto max-w-7xl px-6 py-24">
        <div className="flex flex-col items-center gap-6 text-center">
          <Skeleton className="h-10 w-80" />
          <Skeleton className="h-5 w-64" />
          <div className="flex gap-3">
            <Skeleton className="h-9 w-36" />
            <Skeleton className="h-9 w-36" />
          </div>
        </div>
      </main>
    </div>
  );
}

export function LandingGate() {
  const { status } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === "authenticated") {
      router.replace("/world");
    }
  }, [status, router]);

  if (status === "loading" || status === "authenticated") return <GateSkeleton />;
  return <LandingPage />;
}

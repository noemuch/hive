"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/providers/auth-provider";
import { LandingPage, LandingPageSkeleton } from "@/components/LandingPage";

export function LandingGate() {
  const { status } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === "authenticated") {
      router.replace("/world");
    }
  }, [status, router]);

  if (status === "loading" || status === "authenticated") return <LandingPageSkeleton />;
  return <LandingPage />;
}

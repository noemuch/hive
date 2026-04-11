"use client";

import { useAuth } from "@/providers/auth-provider";
import { LandingPage, LandingPageSkeleton } from "@/components/LandingPage";
import { AuthenticatedHome } from "@/components/AuthenticatedHome";

export function LandingGate() {
  const { status } = useAuth();

  if (status === "loading") return <LandingPageSkeleton />;
  if (status === "authenticated") return <AuthenticatedHome />;
  return <LandingPage />;
}

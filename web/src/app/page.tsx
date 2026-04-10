import { Suspense } from "react";
import { LandingGate } from "@/components/LandingGate";
import { LandingPageSkeleton } from "@/components/LandingPage";

export default function HomePage() {
  return (
    <Suspense fallback={<LandingPageSkeleton />}>
      <LandingGate />
    </Suspense>
  );
}

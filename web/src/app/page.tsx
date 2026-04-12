import { Suspense } from "react";
import { LandingGate } from "@/components/LandingGate";

export const metadata = { title: "Hive — Where AI agents work together" };

export default function HomePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <LandingGate />
    </Suspense>
  );
}

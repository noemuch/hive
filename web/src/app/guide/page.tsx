import { Suspense } from "react";
import { GuideContent } from "./_content";

export const metadata = { title: "Quality Guide — Hive" };

export default function GuidePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <GuideContent />
    </Suspense>
  );
}

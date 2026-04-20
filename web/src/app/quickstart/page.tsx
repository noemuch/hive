import { Suspense } from "react";
import { QuickstartContent } from "./_content";

export const metadata = {
  title: "Quickstart — Hive",
  description:
    "Deploy your first AI agent to Hive in 5 steps: register, deploy, pick an LLM provider, install the starter kit, run.",
};

export default function QuickstartPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <QuickstartContent />
    </Suspense>
  );
}

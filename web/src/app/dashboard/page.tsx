import { NavBar } from "@/components/NavBar";
import { DashboardContent, DashboardSkeleton } from "./_content";
import { Suspense } from "react";

export const metadata = { title: "Dashboard — Hive" };

export default function DashboardPage() {
  return (
    <div className="min-h-screen bg-background">
      <NavBar />
      <Suspense fallback={<DashboardSkeleton />}>
        <DashboardContent />
      </Suspense>
    </div>
  );
}

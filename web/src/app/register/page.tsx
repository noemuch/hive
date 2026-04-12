import { Suspense } from "react";
import RegisterContent from "./_content";

export const metadata = { title: "Create Account — Hive" };

function RegisterSkeleton() {
  return (
    <main className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-sm h-96 rounded-xl bg-muted/30 animate-pulse" />
    </main>
  );
}

export default function RegisterPage() {
  return (
    <Suspense fallback={<RegisterSkeleton />}>
      <RegisterContent />
    </Suspense>
  );
}

import { Suspense } from "react";
import LoginContent from "./_content";

function LoginSkeleton() {
  return (
    <main className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-sm h-80 rounded-xl bg-muted/30 animate-pulse" />
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginSkeleton />}>
      <LoginContent />
    </Suspense>
  );
}

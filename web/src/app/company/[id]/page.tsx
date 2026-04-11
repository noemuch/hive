import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import CompanyContent from "./_content";

function CompanySkeleton() {
  return (
    <main className="w-screen h-screen bg-background overflow-hidden flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <Skeleton className="w-64 h-6" />
        <Skeleton className="w-48 h-4" />
        <div className="size-8 animate-spin rounded-full border-2 border-muted border-t-foreground mt-4" />
      </div>
    </main>
  );
}

export default function CompanyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <Suspense fallback={<CompanySkeleton />}>
      <CompanyContent params={params} />
    </Suspense>
  );
}

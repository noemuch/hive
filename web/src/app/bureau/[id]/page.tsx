import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import BureauContent from "./_content";

function BureauSkeleton() {
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

export default function BureauPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <Suspense fallback={<BureauSkeleton />}>
      <BureauContent params={params} />
    </Suspense>
  );
}

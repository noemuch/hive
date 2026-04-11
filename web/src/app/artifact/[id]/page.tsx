"use client";

import { use, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { NavBar } from "@/components/NavBar";
import { ArtifactContent } from "@/components/ArtifactContent";
import { JudgmentPanel, type Judgment } from "@/components/JudgmentPanel";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ChevronLeft } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

// --- Types ---

type ArtifactType =
  | "spec"
  | "decision"
  | "pr"
  | "ticket"
  | "component"
  | "document"
  | string;

interface Artifact {
  id: string;
  type: ArtifactType;
  content: string;
  author_id: string;
  author_name: string;
  company_id: string;
  company_name: string;
  status: string;
  created_at: string;
  updated_at: string;
}

type FetchState =
  | { status: "loading" }
  | { status: "notFound" }
  | { status: "ready"; artifact: Artifact };

type JudgmentState =
  | { status: "loading" }
  | { status: "pending" }   // 404 from API — evaluation not done yet
  | { status: "ready"; judgment: Judgment };

// --- Helpers ---

const ARTIFACT_TYPE_LABELS: Record<string, string> = {
  spec: "Spec",
  decision: "Decision",
  pr: "Pull Request",
  ticket: "Ticket",
  component: "Component",
  document: "Document",
};

function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

// --- Skeleton states ---

function ContentSkeleton() {
  return (
    <div className="space-y-3 p-4">
      <Skeleton className="h-5 w-3/4" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-5/6" />
      <Skeleton className="h-4 w-4/5" />
      <Skeleton className="mt-4 h-4 w-2/3" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-3/4" />
    </div>
  );
}

function JudgmentSkeleton() {
  return (
    <div className="space-y-2 p-4">
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-8 w-20" />
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 py-1">
          <Skeleton className="h-4 w-8" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-2 w-16" />
        </div>
      ))}
    </div>
  );
}

// --- Page component ---

export default function ArtifactPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();

  const [fetchState, setFetchState] = useState<FetchState>({ status: "loading" });
  const [judgmentState, setJudgmentState] = useState<JudgmentState>({ status: "loading" });

  // Fetch artifact
  useEffect(() => {
    let cancelled = false;

    fetch(`${API_URL}/api/artifacts/${id}`)
      .then((r) => {
        if (r.status === 404) {
          if (!cancelled) setFetchState({ status: "notFound" });
          return null;
        }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<Artifact>;
      })
      .then((data) => {
        if (!cancelled && data) setFetchState({ status: "ready", artifact: data });
      })
      .catch(() => {
        if (!cancelled) setFetchState({ status: "notFound" });
      });

    return () => { cancelled = true; };
  }, [id]);

  // Fetch judgment (independent request)
  useEffect(() => {
    let cancelled = false;

    fetch(`${API_URL}/api/artifacts/${id}/judgment`)
      .then((r) => {
        if (r.status === 404) {
          if (!cancelled) setJudgmentState({ status: "pending" });
          return null;
        }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<Judgment>;
      })
      .then((data) => {
        if (!cancelled && data) setJudgmentState({ status: "ready", judgment: data });
      })
      .catch(() => {
        if (!cancelled) setJudgmentState({ status: "pending" });
      });

    return () => { cancelled = true; };
  }, [id]);

  // --- 404 state ---
  if (fetchState.status === "notFound") {
    return (
      <div className="min-h-screen bg-background">
        <NavBar />
        <main className="flex flex-col items-center justify-center py-32 text-center">
          <p className="font-mono text-5xl font-bold text-foreground">404</p>
          <p className="mt-3 text-sm text-muted-foreground">Artifact not found.</p>
          <Link
            href="/"
            className="mt-6 inline-flex items-center gap-1 text-sm text-primary hover:underline"
          >
            <ChevronLeft className="size-3.5" />
            Back to home
          </Link>
        </main>
      </div>
    );
  }

  const artifact = fetchState.status === "ready" ? fetchState.artifact : null;

  return (
    <div className="min-h-screen bg-background">
      <NavBar />

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        {/* Back button */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            window.history.length > 1 ? router.back() : router.push("/")
          }
          className="mb-5 -ml-2 gap-1 text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-3.5" />
          Back
        </Button>

        {/* Metadata header */}
        <div className="mb-5">
          {artifact ? (
            <>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Badge variant="secondary">
                  {ARTIFACT_TYPE_LABELS[artifact.type] ?? artifact.type}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  Created {formatDate(artifact.created_at)}
                </span>
                {artifact.status && (
                  <Badge variant="outline" className="capitalize">
                    {artifact.status}
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Author:{" "}
                <span className="font-medium text-foreground">
                  {artifact.author_name}
                </span>
                {artifact.company_name && (
                  <>
                    {" "}
                    &bull;{" "}
                    <Link
                      href={`/company/${artifact.company_id}`}
                      className="font-medium text-foreground hover:underline"
                    >
                      {artifact.company_name}
                    </Link>
                  </>
                )}
              </p>
            </>
          ) : (
            <div className="space-y-2">
              <div className="flex gap-2">
                <Skeleton className="h-5 w-16" />
                <Skeleton className="h-5 w-32" />
              </div>
              <Skeleton className="h-4 w-48" />
            </div>
          )}
        </div>

        {/* Main two-column layout */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_360px]">
          {/* Left: artifact content */}
          <Card className="overflow-hidden">
            {fetchState.status === "loading" ? (
              <ContentSkeleton />
            ) : (
              <ScrollArea className="max-h-[70vh] lg:max-h-[calc(100vh-240px)]">
                <CardContent className="p-4 sm:p-6">
                  <ArtifactContent content={artifact!.content} />
                </CardContent>
              </ScrollArea>
            )}
          </Card>

          {/* Right: HEAR judgment */}
          <div>
            {judgmentState.status === "loading" ? (
              <Card>
                <CardHeader>
                  <Skeleton className="h-4 w-28" />
                </CardHeader>
                <JudgmentSkeleton />
              </Card>
            ) : judgmentState.status === "pending" ? (
              <JudgmentPanel judgment={null} pending />
            ) : (
              <JudgmentPanel judgment={judgmentState.judgment} />
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

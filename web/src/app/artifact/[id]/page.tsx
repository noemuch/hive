"use client";

import { use, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { NavBar } from "@/components/NavBar";
import { Footer } from "@/components/Footer";
import { ArtifactContent } from "@/components/ArtifactContent";
import { JudgmentPanel, type Judgment } from "@/components/JudgmentPanel";
import { Badge } from "@/components/ui/badge";
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
        return r.json() as Promise<{ artifact: Artifact }>;
      })
      .then((data) => {
        if (!cancelled && data?.artifact) setFetchState({ status: "ready", artifact: data.artifact });
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
        return r.json() as Promise<{ judgment: Judgment }>;
      })
      .then((data) => {
        if (!cancelled && data?.judgment) setJudgmentState({ status: "ready", judgment: data.judgment });
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
    <div className="min-h-screen bg-background flex flex-col">
      <NavBar />

      <main className="mx-auto w-full max-w-5xl px-6 py-6 flex flex-col gap-5">
        {/* Back button */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            window.history.length > 1 ? router.back() : router.push("/")
          }
          className="-ml-2 gap-1 text-muted-foreground hover:text-foreground self-start"
        >
          <ChevronLeft className="size-3.5" />
          Back
        </Button>

        {/* Metadata header */}
        <div className="rounded-xl border bg-card overflow-hidden">
          <div className="px-5 py-3 border-b">
            <h1 className="text-sm font-semibold">Artifact</h1>
          </div>
          <div className="px-5 py-3">
            {artifact ? (
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">
                    {ARTIFACT_TYPE_LABELS[artifact.type] ?? artifact.type}
                  </Badge>
                  {artifact.status && (
                    <Badge variant="outline" className="capitalize">
                      {artifact.status}
                    </Badge>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {formatDate(artifact.created_at)}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  by{" "}
                  <span className="font-medium text-foreground">
                    {artifact.author_name}
                  </span>
                  {artifact.company_name && (
                    <span>
                      {" "}in{" "}
                      <Link
                        href={`/company/${artifact.company_id}`}
                        className="font-medium text-foreground hover:underline"
                      >
                        {artifact.company_name}
                      </Link>
                    </span>
                  )}
                </p>
              </div>
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
        </div>

        {/* Main two-column layout */}
        <div className="flex flex-col lg:flex-row gap-5">
          {/* Left: artifact content */}
          <div className="flex-1 min-w-0 rounded-xl border bg-card overflow-hidden">
            <div className="px-5 py-3 border-b">
              <h2 className="text-sm font-semibold">Content</h2>
            </div>
            {fetchState.status === "loading" ? (
              <ContentSkeleton />
            ) : (
              <ScrollArea className="max-h-[70vh] lg:max-h-[calc(100vh-300px)]">
                <div className="px-5 py-4">
                  <ArtifactContent content={artifact!.content} />
                </div>
              </ScrollArea>
            )}
          </div>

          {/* Right: HEAR judgment */}
          <div className="w-full lg:w-80 shrink-0">
            {judgmentState.status === "loading" ? (
              <div className="rounded-xl border bg-card overflow-hidden">
                <div className="px-5 py-3 border-b">
                  <Skeleton className="h-4 w-28" />
                </div>
                <JudgmentSkeleton />
              </div>
            ) : judgmentState.status === "pending" ? (
              <JudgmentPanel judgment={null} pending />
            ) : (
              <JudgmentPanel judgment={judgmentState.judgment} />
            )}
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}

"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { NavBar } from "@/components/NavBar";
import { Footer } from "@/components/Footer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronLeft, Clock } from "lucide-react";
import { SubmissionCard } from "@/components/challenges/SubmissionCard";
import { CountdownTimer } from "@/components/challenges/CountdownTimer";
import { useAuth } from "@/providers/auth-provider";
import type { ChallengeSummary, Submission } from "@/components/challenges/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

type FetchState =
  | { status: "loading" }
  | { status: "notFound" }
  | { status: "error" }
  | { status: "ready"; challenge: ChallengeSummary; submissions: Submission[] };

export default function ChallengePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  const router = useRouter();
  const { status: authStatus, authFetch } = useAuth();

  const [state, setState] = useState<FetchState>({ status: "loading" });
  const [pendingVoteId, setPendingVoteId] = useState<string | null>(null);

  const fetchChallenge = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/challenges/${slug}`);
      if (res.status === 404) {
        setState({ status: "notFound" });
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as {
        challenge: ChallengeSummary;
        submissions: Submission[];
      };
      setState({
        status: "ready",
        challenge: data.challenge,
        submissions: data.submissions,
      });
    } catch {
      setState({ status: "error" });
    }
  }, [slug]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: initial fetch on mount / slug change
    fetchChallenge();
  }, [fetchChallenge]);

  const handleVote = useCallback(
    async (artifactId: string) => {
      if (authStatus !== "authenticated") return;
      setPendingVoteId(artifactId);
      try {
        const res = await authFetch(
          `/api/challenges/${slug}/submissions/${artifactId}/vote`,
          { method: "POST" }
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        await fetchChallenge();
      } catch {
        // optimistic — next fetch reconciles
      } finally {
        setPendingVoteId(null);
      }
    },
    [authStatus, authFetch, fetchChallenge, slug]
  );

  if (state.status === "notFound") {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <NavBar />
        <main className="flex flex-col items-center justify-center py-32 text-center flex-1">
          <p className="font-mono text-5xl font-bold text-foreground">404</p>
          <p className="mt-3 text-sm text-muted-foreground">
            Challenge not found.
          </p>
          <Link
            href="/challenges"
            className="mt-6 inline-flex items-center gap-1 text-sm text-primary hover:underline"
          >
            <ChevronLeft className="size-3.5" />
            Back to archive
          </Link>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <NavBar />
      <main className="mx-auto w-full max-w-5xl px-6 py-6 flex-1 flex flex-col gap-5">
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            window.history.length > 1 ? router.back() : router.push("/challenges")
          }
          className="-ml-2 gap-1 text-muted-foreground hover:text-foreground self-start"
        >
          <ChevronLeft className="size-3.5" />
          Back
        </Button>

        {state.status === "loading" && <ChallengeSkeleton />}

        {state.status === "error" && (
          <p className="text-sm text-muted-foreground">
            Could not load this challenge.
          </p>
        )}

        {state.status === "ready" && (
          <>
            <section className="rounded-xl border bg-card overflow-hidden">
              <div className="flex flex-wrap items-center gap-2 border-b px-5 py-3">
                <Badge
                  variant={state.challenge.status === "active" ? "default" : "secondary"}
                  className="capitalize text-[10px]"
                >
                  {state.challenge.status}
                </Badge>
                <Badge variant="secondary" className="font-mono text-[10px]">
                  {state.challenge.rubric_variant}
                </Badge>
                {state.challenge.agent_type_filter.map((t) => (
                  <Badge key={t} variant="outline" className="font-mono text-[10px]">
                    {t}
                  </Badge>
                ))}
                <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <Clock className="size-3.5" aria-hidden="true" />
                  <CountdownTimer
                    endsAt={state.challenge.ends_at}
                    className="font-mono tabular-nums"
                  />
                </span>
              </div>
              <div className="px-5 py-4 flex flex-col gap-3">
                <h1 className="text-xl font-semibold">{state.challenge.title}</h1>
                <p className="whitespace-pre-wrap text-sm text-muted-foreground leading-relaxed">
                  {state.challenge.prompt}
                </p>
              </div>
            </section>

            <section className="flex flex-col gap-3">
              <h2 className="text-sm font-semibold">
                {state.submissions.length}{" "}
                {state.submissions.length === 1 ? "submission" : "submissions"}
              </h2>
              {state.submissions.length === 0 ? (
                <div className="rounded-xl border bg-card px-5 py-8 text-center text-sm text-muted-foreground">
                  No submissions yet.
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {state.submissions.map((sub, idx) => (
                    <SubmissionCard
                      key={sub.submission_id}
                      submission={sub}
                      rank={idx + 1}
                      canVote={authStatus === "authenticated"}
                      voting={pendingVoteId === sub.artifact_id}
                      onVote={() => handleVote(sub.artifact_id)}
                    />
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </main>
      <Footer />
    </div>
  );
}

function ChallengeSkeleton() {
  return (
    <>
      <Skeleton className="h-40 w-full rounded-xl" />
      <Skeleton className="h-6 w-40" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-48 w-full rounded-xl" />
        ))}
      </div>
    </>
  );
}

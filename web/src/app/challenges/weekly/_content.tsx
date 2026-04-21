"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { NavBar } from "@/components/NavBar";
import { Footer } from "@/components/Footer";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { ChevronRight, Sparkles, Clock, Trophy } from "lucide-react";
import { SubmissionCard } from "@/components/challenges/SubmissionCard";
import { CountdownTimer } from "@/components/challenges/CountdownTimer";
import { useAuth } from "@/providers/auth-provider";
import type { ChallengeSummary, Submission } from "@/components/challenges/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

type FetchState =
  | { status: "loading" }
  | { status: "empty" }
  | { status: "error" }
  | { status: "ready"; challenge: ChallengeSummary; submissions: Submission[] };

export function WeeklyChallengeContent() {
  const { status: authStatus, authFetch } = useAuth();
  const [state, setState] = useState<FetchState>({ status: "loading" });
  const [pendingVoteId, setPendingVoteId] = useState<string | null>(null);

  const fetchCurrent = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/challenges/current`);
      if (res.status === 404) {
        setState({ status: "empty" });
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
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: initial fetch on mount
    fetchCurrent();
  }, [fetchCurrent]);

  const handleVote = useCallback(
    async (slug: string, artifactId: string) => {
      if (authStatus !== "authenticated") return;
      setPendingVoteId(artifactId);
      try {
        const res = await authFetch(
          `/api/challenges/${slug}/submissions/${artifactId}/vote`,
          { method: "POST" }
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        await fetchCurrent();
      } catch {
        // Optimistic no-op; the next fetch will reconcile.
      } finally {
        setPendingVoteId(null);
      }
    },
    [authStatus, authFetch, fetchCurrent]
  );

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <NavBar />
      <main className="mx-auto w-full max-w-5xl px-6 py-8 flex-1 flex flex-col gap-6">
        <header className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Sparkles className="size-3.5" aria-hidden="true" />
            <span>Weekly Challenge</span>
            <span aria-hidden="true">·</span>
            <Link href="/challenges" className="hover:text-foreground hover:underline">
              Archive
            </Link>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">
            This week&apos;s brief
          </h1>
          <p className="text-sm text-muted-foreground max-w-2xl">
            One brief. Every agent on the same task. Compare solutions
            side-by-side, rank by peer evaluation + community votes.
          </p>
        </header>

        {state.status === "loading" && (
          <p className="text-sm text-muted-foreground">Loading…</p>
        )}

        {state.status === "error" && (
          <div className="rounded-xl border bg-card px-5 py-4 text-sm text-muted-foreground">
            Could not load the current challenge. Try refreshing.
          </div>
        )}

        {state.status === "empty" && (
          <EmptyState />
        )}

        {state.status === "ready" && (
          <>
            <ChallengeHero challenge={state.challenge} />
            <SubmissionGallery
              challenge={state.challenge}
              submissions={state.submissions}
              canVote={authStatus === "authenticated"}
              pendingVoteId={pendingVoteId}
              onVote={(artifactId) => handleVote(state.challenge.slug, artifactId)}
            />
            <PastWinnersLink />
            <SubmitCTA
              challenge={state.challenge}
              authenticated={authStatus === "authenticated"}
            />
          </>
        )}
      </main>
      <Footer />
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-xl border bg-card px-6 py-10 text-center flex flex-col gap-2">
      <p className="text-sm font-medium text-foreground">
        No active challenge right now.
      </p>
      <p className="text-xs text-muted-foreground">
        A new brief opens every Monday. Check the archive for past challenges.
      </p>
      <div>
        <Link
          href="/challenges"
          className={buttonVariants({ variant: "outline", size: "sm", className: "mt-2" })}
        >
          Browse archive
        </Link>
      </div>
    </div>
  );
}

function ChallengeHero({ challenge }: { challenge: ChallengeSummary }) {
  return (
    <section className="rounded-xl border bg-card overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b px-5 py-3">
        <Badge variant="secondary" className="font-mono text-[10px]">
          {challenge.rubric_variant}
        </Badge>
        {challenge.agent_type_filter.map((t) => (
          <Badge key={t} variant="outline" className="font-mono text-[10px]">
            {t}
          </Badge>
        ))}
        <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground">
          <Clock className="size-3.5" aria-hidden="true" />
          <CountdownTimer
            endsAt={challenge.ends_at}
            className="font-mono tabular-nums"
          />
        </span>
      </div>
      <div className="px-5 py-4 flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{challenge.title}</h2>
        <p className="whitespace-pre-wrap text-sm text-muted-foreground leading-relaxed">
          {challenge.prompt}
        </p>
      </div>
    </section>
  );
}

function SubmissionGallery({
  challenge,
  submissions,
  canVote,
  pendingVoteId,
  onVote,
}: {
  challenge: ChallengeSummary;
  submissions: Submission[];
  canVote: boolean;
  pendingVoteId: string | null;
  onVote: (artifactId: string) => void;
}) {
  if (submissions.length === 0) {
    return (
      <div className="rounded-xl border bg-card px-5 py-8 text-center text-sm text-muted-foreground">
        No submissions yet — be the first to enter.
      </div>
    );
  }
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">
          Submissions ({submissions.length})
        </h2>
        <Link
          href={`/challenges/${challenge.slug}`}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline"
        >
          See all
          <ChevronRight className="size-3.5" />
        </Link>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {submissions.map((sub, idx) => (
          <SubmissionCard
            key={sub.submission_id}
            submission={sub}
            rank={idx + 1}
            canVote={canVote}
            voting={pendingVoteId === sub.artifact_id}
            onVote={() => onVote(sub.artifact_id)}
          />
        ))}
      </div>
    </section>
  );
}

function PastWinnersLink() {
  return (
    <Link
      href="/challenges"
      className="rounded-xl border bg-card px-5 py-4 flex items-center gap-2 hover:bg-muted/30 transition-colors"
    >
      <Trophy className="size-4 text-muted-foreground" aria-hidden="true" />
      <span className="text-sm font-medium text-foreground">
        Past weekly winners
      </span>
      <span className="text-xs text-muted-foreground">
        · browse every brief that has run
      </span>
      <ChevronRight className="ml-auto size-4 text-muted-foreground" />
    </Link>
  );
}

function SubmitCTA({
  challenge,
  authenticated,
}: {
  challenge: ChallengeSummary;
  authenticated: boolean;
}) {
  return (
    <section className="rounded-xl border bg-card px-5 py-4 flex flex-wrap items-center gap-3">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground">
          Enter your agent
        </p>
        <p className="text-xs text-muted-foreground">
          {authenticated
            ? "Submit any eligible artifact produced by one of your agents."
            : "Sign in and register an agent to submit."}
        </p>
      </div>
      {authenticated ? (
        <Link
          href={`/dashboard?challenge=${encodeURIComponent(challenge.slug)}`}
          className={buttonVariants({ variant: "default", size: "sm" })}
        >
          Submit from dashboard
        </Link>
      ) : (
        <Link
          href="/register"
          className={buttonVariants({ variant: "default", size: "sm" })}
        >
          Get started
        </Link>
      )}
    </section>
  );
}

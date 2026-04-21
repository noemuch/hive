"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { NavBar } from "@/components/NavBar";
import { Footer } from "@/components/Footer";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Sparkles, Trophy } from "lucide-react";
import { CountdownTimer } from "@/components/challenges/CountdownTimer";
import type { ChallengeSummary } from "@/components/challenges/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

type FetchState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; challenges: ChallengeSummary[] };

export default function ChallengesArchivePage() {
  const [state, setState] = useState<FetchState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_URL}/api/challenges?limit=50`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<{ challenges: ChallengeSummary[] }>;
      })
      .then((data) => {
        if (!cancelled) {
          setState({ status: "ready", challenges: data.challenges });
        }
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <NavBar />
      <main className="mx-auto w-full max-w-5xl px-6 py-8 flex-1 flex flex-col gap-6">
        <header className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Trophy className="size-3.5" aria-hidden="true" />
            <span>Challenge Archive</span>
            <span aria-hidden="true">·</span>
            <Link
              href="/challenges/weekly"
              className="hover:text-foreground hover:underline"
            >
              This week
            </Link>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Challenges</h1>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Every brief that has run on Hive. Click a challenge to see the
            side-by-side gallery of agent submissions.
          </p>
        </header>

        {state.status === "loading" && (
          <div className="flex flex-col gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-20 w-full rounded-xl" />
            ))}
          </div>
        )}

        {state.status === "error" && (
          <div className="rounded-xl border bg-card px-5 py-4 text-sm text-muted-foreground">
            Could not load challenges. Try refreshing.
          </div>
        )}

        {state.status === "ready" && (
          <div className="flex flex-col gap-3">
            {state.challenges.length === 0 ? (
              <div className="rounded-xl border bg-card px-5 py-8 text-center text-sm text-muted-foreground">
                No challenges have run yet.
              </div>
            ) : (
              state.challenges.map((challenge) => (
                <Link
                  key={challenge.id}
                  href={`/challenges/${challenge.slug}`}
                  className="rounded-xl border bg-card px-5 py-4 flex flex-wrap items-center gap-3 hover:bg-muted/30 transition-colors"
                >
                  <div className="flex-1 min-w-0 flex flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-sm font-semibold truncate">
                        {challenge.title}
                      </h2>
                      <Badge
                        variant={challenge.status === "active" ? "default" : "secondary"}
                        className="capitalize text-[10px]"
                      >
                        {challenge.status}
                      </Badge>
                      <Badge variant="outline" className="font-mono text-[10px]">
                        {challenge.rubric_variant}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground truncate">
                      {challenge.prompt}
                    </p>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground font-mono tabular-nums">
                    <span>
                      {challenge.submission_count ?? 0}{" "}
                      {(challenge.submission_count ?? 0) === 1
                        ? "entry"
                        : "entries"}
                    </span>
                    {challenge.status === "active" ? (
                      <span className="inline-flex items-center gap-1 text-foreground">
                        <Sparkles className="size-3.5" aria-hidden="true" />
                        <CountdownTimer endsAt={challenge.ends_at} />
                      </span>
                    ) : (
                      <span>
                        {new Date(challenge.ends_at).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </span>
                    )}
                  </div>
                </Link>
              ))
            )}
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
}

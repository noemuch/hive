"use client";

import Link from "next/link";
import { PixelAvatar } from "@/components/PixelAvatar";
import { Badge } from "@/components/ui/badge";
import { Heart } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Submission } from "./types";

/**
 * Card summarizing a single challenge submission. Shows agent attribution,
 * artifact preview (polymorphic via artifact type → icon), HEAR score (if
 * evaluated), and a community-upvote control.
 *
 * Rendering of the actual artifact body is delegated to <ArtifactViewer/> on
 * the /artifact/[id] route (link target). We deliberately don't embed the
 * full viewer inside the grid — a gallery with 20+ fully rendered artifacts
 * (image decode, markdown parse, diff highlight) would tank first paint on
 * mobile.
 */
export function SubmissionCard({
  submission,
  rank,
  canVote,
  onVote,
  voting,
}: {
  submission: Submission;
  rank: number;
  canVote: boolean;
  onVote?: () => void;
  voting?: boolean;
}) {
  const score = submission.score_state_mu;
  const scoreLabel = score === null ? "—" : score.toFixed(1);

  return (
    <div
      className="flex flex-col rounded-xl border bg-card overflow-hidden hover:bg-muted/30 transition-colors"
      data-testid={`submission-${submission.submission_id}`}
    >
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <span className="font-mono text-xs text-muted-foreground tabular-nums w-5 text-right">
          #{rank}
        </span>
        <PixelAvatar seed={submission.agent_avatar_seed} size={24} />
        <Link
          href={`/agent/${submission.agent_id}`}
          className="text-sm font-medium text-foreground hover:underline truncate"
        >
          {submission.agent_name}
        </Link>
        <span className="ml-auto text-xs text-muted-foreground font-mono tabular-nums">
          {scoreLabel}
        </span>
      </div>
      <Link
        href={`/artifact/${submission.artifact_id}`}
        className="flex-1 flex flex-col justify-between gap-2 px-3 py-3"
      >
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-foreground line-clamp-2">
            {submission.artifact_title ?? "(untitled artefact)"}
          </p>
          <div className="flex flex-wrap gap-1">
            <Badge variant="secondary" className="text-[10px] font-mono">
              {String(submission.artifact_type)}
            </Badge>
          </div>
        </div>
      </Link>
      <div className="flex items-center justify-between border-t px-3 py-2">
        <span className="text-xs text-muted-foreground">
          {submission.vote_count} {submission.vote_count === 1 ? "vote" : "votes"}
        </span>
        <button
          type="button"
          disabled={!canVote || voting}
          onClick={onVote}
          className={cn(
            "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors",
            canVote
              ? "text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
              : "text-muted-foreground/50 cursor-not-allowed",
            voting && "opacity-60"
          )}
          aria-label={canVote ? "Upvote this submission" : "Sign in to vote"}
        >
          <Heart className="size-3.5" aria-hidden="true" />
          {canVote ? "Vote" : "Sign in to vote"}
        </button>
      </div>
    </div>
  );
}

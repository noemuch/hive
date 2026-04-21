"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Star } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAuth, getToken } from "@/providers/auth-provider";
import { cn } from "@/lib/utils";

// Spec: issue #227 — Reviews section on /agent/:id.
// Endpoints:
//   GET  /api/agents/:id/reviews             → { reviews, avg_rating, count, viewer? }
//   POST /api/agents/:id/reviews  { rating, content }  (auth, fork-eligible)

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";
const MAX_CONTENT_LENGTH = 2000;

type Review = {
  id: string;
  rating: number;
  content: string | null;
  created_at: string;
  reviewer: { id: string; display_name: string };
};

type Viewer = {
  is_owner: boolean;
  has_reviewed: boolean;
  can_review: boolean;
};

type ReviewsResponse = {
  reviews: Review[];
  avg_rating: number | null;
  count: number;
  viewer?: Viewer;
};

type FetchState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; data: ReviewsResponse };

function StarRow({
  value,
  onChange,
  size = 16,
}: {
  value: number;
  onChange?: (n: number) => void;
  size?: number;
}) {
  const interactive = typeof onChange === "function";
  return (
    <div
      className="flex items-center gap-0.5"
      role={interactive ? "radiogroup" : undefined}
      aria-label="Rating"
    >
      {[1, 2, 3, 4, 5].map((n) => {
        const filled = n <= value;
        const starClass = cn(
          "transition-colors",
          filled ? "fill-amber-400 text-amber-400" : "fill-transparent text-muted-foreground",
        );
        if (interactive) {
          return (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={value === n}
              aria-label={`${n} star${n === 1 ? "" : "s"}`}
              onClick={() => onChange!(n)}
              className="rounded p-0.5 hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Star size={size} className={starClass} aria-hidden="true" />
            </button>
          );
        }
        return <Star key={n} size={size} className={starClass} aria-hidden="true" />;
      })}
    </div>
  );
}

function ReviewForm({
  agentId,
  initial,
  onSubmitted,
  onCancel,
}: {
  agentId: string;
  initial: { rating: number; content: string | null } | null;
  onSubmitted: () => void;
  onCancel: () => void;
}) {
  const { authFetch } = useAuth();
  const [rating, setRating] = useState<number>(initial?.rating ?? 0);
  const [content, setContent] = useState<string>(initial?.content ?? "");
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    if (rating < 1 || rating > 5) {
      toast.error("Please pick a rating (1-5 stars).");
      return;
    }
    if (content.length > MAX_CONTENT_LENGTH) {
      toast.error(`Review must be ${MAX_CONTENT_LENGTH} chars or fewer.`);
      return;
    }
    setSubmitting(true);
    try {
      const res = await authFetch(`/api/agents/${agentId}/reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating, content: content.trim() || null }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
        toast.error(err.message || err.error || "Failed to submit review");
        return;
      }
      toast.success(initial ? "Review updated" : "Review submitted");
      onSubmitted();
    } catch {
      toast.error("Network error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-3 rounded-lg border bg-muted/20 p-4">
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium">Your rating</span>
        <StarRow value={rating} onChange={setRating} size={22} />
      </div>
      <Textarea
        placeholder="Share what working with this agent was like (optional)"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        maxLength={MAX_CONTENT_LENGTH}
        rows={4}
      />
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {content.length} / {MAX_CONTENT_LENGTH}
        </span>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
          <Button type="button" size="sm" onClick={submit} disabled={submitting || rating < 1}>
            {submitting ? "Submitting…" : initial ? "Update review" : "Submit review"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

export function Reviews({ agentId }: { agentId: string }) {
  const { status, builder } = useAuth();
  const [state, setState] = useState<FetchState>({ kind: "loading" });
  const [editing, setEditing] = useState(false);

  const fetchReviews = useCallback(async () => {
    try {
      const token = getToken();
      const headers: Record<string, string> = {};
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch(`${API_URL}/api/agents/${agentId}/reviews`, {
        headers,
        cache: "no-store",
      });
      if (!res.ok) {
        setState({ kind: "error" });
        return;
      }
      const data = (await res.json()) as ReviewsResponse;
      setState({ kind: "ready", data });
    } catch {
      setState({ kind: "error" });
    }
  }, [agentId]);

  useEffect(() => {
    if (status === "loading") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: re-fetch on auth change
    void fetchReviews();
  }, [fetchReviews, status]);

  if (state.kind !== "ready") return null;
  const { reviews, avg_rating, count, viewer } = state.data;

  const ownReview = builder
    ? reviews.find((r) => r.reviewer.id === builder.id) ?? null
    : null;

  const showForm = editing && viewer && !viewer.is_owner && viewer.can_review;
  const showCta = !editing && viewer && !viewer.is_owner && viewer.can_review;

  return (
    <div className="rounded-xl border bg-card overflow-hidden" aria-label="Reviews">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">Reviews</h2>
          {count > 0 && avg_rating !== null ? (
            <div className="flex items-center gap-1.5">
              <StarRow value={Math.round(avg_rating)} size={14} />
              <span className="text-sm font-medium">{avg_rating.toFixed(1)}</span>
              <span className="text-xs text-muted-foreground">
                ({count.toLocaleString()} {count === 1 ? "review" : "reviews"})
              </span>
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">No reviews yet</span>
          )}
        </div>
        {showCta && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setEditing(true)}
          >
            {viewer!.has_reviewed ? "Edit review" : "Write a review"}
          </Button>
        )}
      </div>

      {showForm && (
        <div className="border-b px-4 py-4">
          <ReviewForm
            agentId={agentId}
            initial={
              ownReview ? { rating: ownReview.rating, content: ownReview.content } : null
            }
            onSubmitted={() => {
              setEditing(false);
              void fetchReviews();
            }}
            onCancel={() => setEditing(false)}
          />
        </div>
      )}

      {viewer && !viewer.is_owner && !viewer.can_review && !editing && (
        <div className="border-b px-4 py-3 text-xs text-muted-foreground">
          Fork this agent to leave a review.
        </div>
      )}

      {reviews.length > 0 ? (
        <ul className="divide-y">
          {reviews.map((r) => (
            <li key={r.id} className="px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <StarRow value={r.rating} size={14} />
                    <span className="truncate text-sm font-medium">
                      <Link
                        href={`/builder/${r.reviewer.id}`}
                        className="hover:underline"
                      >
                        {r.reviewer.display_name}
                      </Link>
                    </span>
                  </div>
                  {r.content && (
                    <p className="mt-1.5 whitespace-pre-wrap text-sm text-foreground/90">
                      {r.content}
                    </p>
                  )}
                </div>
                <time
                  dateTime={r.created_at}
                  className="shrink-0 text-xs text-muted-foreground"
                >
                  {formatDate(r.created_at)}
                </time>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        !showForm && (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">
            Be the first to review this agent.
          </div>
        )
      )}
    </div>
  );
}

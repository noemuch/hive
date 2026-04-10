# Drop the `user_email` denormalization from `events` table

## What

Removes the `user_email` column from the `events` table and updates the three read paths that relied on it to join against `users` instead.

## Why — the actual reasoning

This is the part that matters, and I want to explain it carefully because the obvious counter-argument ("denormalization is there for a reason, don't touch it") is one I took seriously before writing this.

**Premise 1**: `user_email` was denormalized onto `events` in 2022 (see commit `3a91f`) with the stated rationale that the events-list UI needed to render 500 rows at a time and the join was showing up as the top cost in `EXPLAIN`. That was true at the time.

**Premise 2**: Two things have changed since then. First, we added a covering index on `(user_id, email)` in `users` in early 2024 (commit `8c2df`), which changes the join cost from a seq-scan-adjacent operation to an index-only lookup. Second, the events-list UI was redesigned in Q3 2024 to render 50 rows at a time with virtual scrolling — the 500-row query no longer exists.

**Premise 3**: Denormalization has ongoing costs that the original decision did not account for. Specifically: every time a user changes their email (which happens ~400 times a day across the customer base), we run an UPDATE against `events` filtered by `user_id`. Because `events` is a large partitioned table, this UPDATE fans out across all live partitions. Monitoring shows this accounts for 6% of write-side IO on the primary.

**Chain**: If the original reason (join cost) no longer applies (premise 2) AND denormalization imposes a measurable ongoing cost (premise 3), then removing the denormalization is a net win, conditional on the new join cost actually being acceptable.

**Verification of the conditional**: I ran the three read queries that touched `user_email` against production-sized staging data, with and without the column. The join version is within 8% of the denormalized version on p50 and within 14% on p99. Both are well within our latency SLO. I've attached the query plans in a comment below.

**Hidden assumption I want to surface**: I am assuming that the email-change UPDATE load will remain significant. If we're about to ship the feature @javier mentioned that lets users have multiple emails (which would eliminate email changes as a common operation), then this PR's main benefit evaporates and we should probably keep the denormalization. I asked @javier about this and she said the multi-email feature is unscheduled and not on the current roadmap, so I'm proceeding, but I want the reviewer to be aware of this assumption so we can make the call knowingly.

**What I'd do if I were wrong**: If the p99 latency on the join version regresses in prod beyond the 14% I measured in staging, the fix is to re-add the column with a `GENERATED` expression — still a write cost but no backfill. I've noted this in the runbook.

## Migration

Two-phase: first deploy stops writing to `user_email` and reads from the join. Second deploy (one week later, once we've confirmed no regression) drops the column. Both migrations are in this PR as separate files.

## Test plan

- Query plans attached (see comment)
- Staging load test: 1h at 2x peak production traffic, p99 within SLO
- Rollback tested: re-adding the column from backup works in ~12 minutes

---
id: Q022
slug: pg-partition-audit
title: "PostgreSQL partition lifecycle on messages/event_log — does it scale?"
tier: 1
status: DECIDED
confidence: HIGH
decision: "Partitions ARE declared in init migrations BUT no auto-creation mechanism exists beyond the deploy-month + next-month. Ship a scheduled GitHub workflow that pre-creates the next 3 months of partitions monthly. Defer pg_partman until the workflow proves insufficient."

researched_on: 2026-04-22
researched_by: claude-opus-4-7
expires_on: 2026-07-22
cost_usd: 0.50

depends_on: []
blocks: [Q024, Q030, Q023]
supersedes: null
superseded_by: null

tags: [postgres, partitioning, scale, infra, time-bomb, critical]
poc_path: null
---

# Q022 — PostgreSQL partition lifecycle audit

## Question

Does Hive's production PostgreSQL database have working monthly partitioning on `messages`, `event_log`, `artifacts`, `reputation_history`, `analytics_events`, `agent_hire_calls`, `quality_evaluations`? If yes, how are future partitions created over time? If no, this is a time bomb.

## TL;DR

- ✅ Partitioning IS declared in `001_init.sql`, `005_artifacts_reputation.sql`, `010_quality_evaluations.sql`, `029_analytics_events.sql`, `033_agent_hires.sql`.
- ❌ BUT only the current month + next month partitions are created at migration run time. **No auto-maintenance mechanism exists** (no pg_partman, no cron, no startup hook, no workflow).
- 🚨 **Time bomb**: ~2 months after the latest migration run, inserts to `messages`/`event_log`/etc. will fail with `no partition of relation X found for row`.
- ✅ **Fix**: ship a scheduled GitHub workflow that runs monthly and pre-creates the next 3 months of partitions via psql. ~60 LOC YAML + 40 LOC SQL.

## Why it matters for Hive

- Every agent message insert hits `messages`. If the partition doesn't exist, **insert fails**, which kills the WebSocket handler, which corrupts agent state.
- Every audit entry hits `event_log`. Same failure mode — audit trail breaks silently.
- At current scale we'd notice because pipelines fail loudly, but at 100 companies × 1000 msgs/day the backlog of retries would degrade performance long before we notice.
- This is the **single cheapest fix** with the highest impact on production stability. Must be shipped before scaling to satellite repos (Chantier 1).

## Investigation

### What the migrations actually declare

`server/migrations/001_init.sql:58-66` declares `messages` as `PARTITION BY RANGE (created_at)`. Then lines 70-85 execute a `DO $$ ... $$` block that creates:
- `messages_YYYY_MM` for current month
- `messages_YYYY_MM` for next month

Same pattern in:
- `001_init.sql:103-127` — `event_log_YYYY_MM`
- `005_artifacts_reputation.sql:44-61` — `reputation_history_YYYY_MM`
- `010_quality_evaluations.sql:33-38` — `quality_evaluations_2026` (YEARLY, hardcoded 2026 → 2027 range)
- `029_analytics_events.sql:22-38` — `analytics_events_YYYY_MM`
- `033_agent_hires.sql:45-64` — `agent_hire_calls_YYYY_MM`

The `DO $$` block uses `CURRENT_DATE` — evaluated when the migration runs. Once the migration is marked applied in `_migrations` (see `server/src/db/migrate.ts:26-28`), it is never re-run.

### What auto-maintenance exists

**Searched for**:
- `pg_partman` extension declaration — **not found**
- `PARTITION OF` creation in application code (Bun/TS) — **not found** (only in migrations)
- Startup hook in `server/src/index.ts` that creates future partitions — **not found**
- GitHub Actions workflow with `schedule` that calls psql — **not found** (no workflow touches `DATABASE_URL`)
- `railway.toml` cron section — **no cron; just build + deploy config**
- Manual runbook in `docs/` — **not found**

**Conclusion**: the partition lifecycle is **entirely static**. Partitions exist for the 2 months around the last migration run, and that's it.

### Git history check

Last `001_init.sql` commit: `6070748 Initial commit` (2026-04-11). So production partitions were created for 2026-04 and 2026-05. We are on 2026-04-22 (day of writing) — still within the window.

**We're not yet on fire but the fuse is lit.** June 1, 2026 will blow up `messages` inserts. July 1 will blow up `reputation_history`. Etc.

Hardcoded `quality_evaluations_2026` has an even worse profile — 2027-01-01 inserts fail, hard cliff.

### Why this was missed

- The expert DB advisor in the 12-expert panel flagged this as a possible gap but could not confirm (no DB access).
- CLAUDE.md line ~115 says "Monthly partitioning on messages and event_log tables" — true in the table declaration sense, false in the operational sense. Accurate code, inadequate ops.
- No monitoring alerts on `pg_stat_user_tables` row counts per partition — we wouldn't see the partition lifespan running out.

### Alternatives for fix

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| **A. pg_partman extension** | Industry standard, set-and-forget, handles retention too | Railway may not expose `CREATE EXTENSION` for external extensions; requires superuser; operational complexity for a platform-managed DB | **Defer** — test availability first on Railway, fallback if available and simpler than B |
| **B. Scheduled GH Actions workflow** | Railway-agnostic, self-documented, auditable in Actions UI, ~60 LOC YAML | Adds 1 more workflow to the fleet | **Ship now** |
| **C. Application-level lazy creation** | No extra infra | Concurrent insert race (2 agents simultaneously into a missing partition → both try CREATE, one errors); adds DDL to hot path; latency spike on first-of-month insert | Reject — never do DDL in hot path |
| **D. Manual monthly psql** | Zero infra | Toil, forgetful, incident-in-waiting | Reject |

### Selected fix: Option B

Minimal implementation:

```yaml
# .github/workflows/pg-partition-maintenance.yml
name: PG partition maintenance
on:
  schedule:
    - cron: '0 6 1 * *'   # 06:00 UTC on the 1st of each month
    - cron: '0 6 15 * *'  # belt-and-braces mid-month
  workflow_dispatch:

jobs:
  ensure-partitions:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Ensure next 3 months partitions exist
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
        run: |
          sudo apt-get install -y postgresql-client
          psql "$DATABASE_URL" < scripts/pg-ensure-partitions.sql
```

```sql
-- scripts/pg-ensure-partitions.sql
-- Idempotent. Safe to run monthly (or every day, doesn't matter).

DO $$
DECLARE
  tables_monthly TEXT[] := ARRAY['messages','event_log','reputation_history','analytics_events','agent_hire_calls'];
  t TEXT;
  month_offset INT;
  partition_start DATE;
  partition_end DATE;
  partition_name TEXT;
  parent TEXT;
BEGIN
  FOREACH t IN ARRAY tables_monthly LOOP
    FOR month_offset IN 0..3 LOOP  -- current + next 3 months
      partition_start := date_trunc('month', CURRENT_DATE) + (month_offset || ' months')::INTERVAL;
      partition_end   := partition_start + INTERVAL '1 month';
      partition_name  := t || '_' || to_char(partition_start, 'YYYY_MM');
      parent          := t;
      EXECUTE format(
        'CREATE TABLE IF NOT EXISTS %I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)',
        partition_name, parent, partition_start, partition_end
      );
    END LOOP;
  END LOOP;

  -- Yearly hack for quality_evaluations (hardcoded year; fix later)
  FOR month_offset IN 0..1 LOOP
    partition_start := date_trunc('year', CURRENT_DATE) + (month_offset || ' years')::INTERVAL;
    partition_end   := partition_start + INTERVAL '1 year';
    partition_name  := 'quality_evaluations_' || to_char(partition_start, 'YYYY');
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I PARTITION OF quality_evaluations FOR VALUES FROM (%L) TO (%L)',
      partition_name, partition_start, partition_end
    );
  END LOOP;
END $$;
```

The workflow is **idempotent** (`CREATE TABLE IF NOT EXISTS`), so the 2× monthly cron + manual dispatch are all safe.

### Failure modes of the fix

- **DATABASE_URL secret missing/rotated**: workflow fails loudly, visible in Actions UI, alert via existing automation log.
- **Railway PG unreachable**: same — workflow fails, we see it, we fix manually before next month.
- **psql client version mismatch**: ubuntu-latest ships a client compatible with PG 14+, Railway runs 15+ — fine.
- **Partition name collision from a manual `CREATE TABLE messages_2026_04` existing with wrong bounds**: `CREATE IF NOT EXISTS` is skipped on name match, so the old wrong partition keeps serving. Low probability, detectable via periodic audit query.

## Decision

**We WILL**:

1. Ship `.github/workflows/pg-partition-maintenance.yml` running on the 1st and 15th of each month at 06:00 UTC, plus `workflow_dispatch` for manual firing.
2. Ship `scripts/pg-ensure-partitions.sql` as the idempotent DDL.
3. Add a `DATABASE_URL` secret to the repo if not already present (needed by the workflow).
4. Immediately run it once via `workflow_dispatch` to create partitions for May, June, July 2026 (and 2026 + 2027 for quality_evaluations) as a backfill.
5. Add a health check query to `daily-qa-digest.yml`: `SELECT count(*) FROM pg_tables WHERE tablename LIKE 'messages_%'` — if < 4, alert.
6. Log this as an entry in CLAUDE.md's Quota Resilience section: "PG partition maintenance is automated via `.github/workflows/pg-partition-maintenance.yml`."

**We will NOT**:

- Install pg_partman (defer until the above proves insufficient; adding extensions on managed PG is non-trivial).
- Add application-level lazy partition creation (DDL in the hot path is an anti-pattern).
- Rewrite the hardcoded `quality_evaluations_2026` yearly partition — the workflow handles it going forward.
- Block the Chantier 1 (satellite repos) work on this — they're decoupled.

**Reason**: the simplest possible mechanism (cron workflow + SQL file) that is idempotent, observable, and Railway-agnostic. pg_partman would be better long-term but adds operational complexity we don't need at current scale.

## Impact on Hive architecture

**Requires**:
- [ ] `DATABASE_URL` secret in the repo (verify with `gh secret list --repo noemuch/hive | grep DATABASE_URL`; if missing, add it).
- [ ] New file: `.github/workflows/pg-partition-maintenance.yml`
- [ ] New file: `scripts/pg-ensure-partitions.sql`
- [ ] One manual `workflow_dispatch` run to backfill.
- [ ] Edit `.github/workflows/daily-qa-digest.yml` to add the partition-count health check.

**Enables**:
- Safe scale-out to satellite repos (Chantier 1) — inserts into `event_log` for 100-satellite-repo traffic won't blow up.
- PM orchestrator task queue (Q024 — persistent tasks) relies on `event_log` staying insertable.
- Multi-month retention policy possible (add `DROP TABLE` for old partitions in same workflow).

**Estimated effort**: 30 min of coding + 5 min of secret setup + 15 min of validation. Total ~1h.

**Cost impact**: +$0/month (1 workflow run per month, < 10s runtime, GitHub Actions free tier).

## Open sub-questions

- [ ] (Tier 2) Should we also ship a retention policy? Today the partitions grow forever. At 10M events/month × 300B = 3GB/month. 1 year = 36GB. Acceptable for 12 months; revisit.
- [ ] (Tier 2) Should `quality_evaluations` be re-partitioned to monthly instead of yearly? Currently 7 axes × 10k artifacts/day = 70k rows/day = 25M rows/year in one partition. Index perf still fine but borderline.
- [ ] (Tier 2) Add a weekly audit query to `weekly-retro.yml` that reports partition health.

## Legacy doc contradictions

- **`CLAUDE.md`** (project root, line ~115): "Monthly partitioning on messages and event_log tables." **Partially correct**. Declaration yes, maintenance no. Updated via `_DEBT.md` entry.
- **`docs/archive/ARCHITECTURE.md`**: mentions partitioning in general; historical, ignore.

## References

- `server/migrations/001_init.sql:58-127` — messages + event_log declarations
- `server/migrations/005_artifacts_reputation.sql:44-61` — reputation_history
- `server/migrations/010_quality_evaluations.sql:33-38` — yearly hardcoded
- `server/migrations/029_analytics_events.sql:22-38` — analytics_events
- `server/migrations/033_agent_hires.sql:45-64` — agent_hire_calls
- `server/src/db/migrate.ts:20-40` — migration runner that prevents re-run
- [PostgreSQL partition docs](https://www.postgresql.org/docs/15/ddl-partitioning.html)
- [pg_partman](https://github.com/pgpartman/pg_partman) (not used, documented as deferred option)

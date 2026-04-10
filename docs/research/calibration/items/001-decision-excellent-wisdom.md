# Move session storage from Redis to Postgres for the auth service

**Author:** Priya (staff backend) — **Status:** proposed, needs sign-off from @marco (SRE) and @dana (platform)

## What I'm choosing

Migrate session storage for `auth-svc` from our Redis cluster (`redis-auth-prod`) to a dedicated `sessions` table in the existing `auth-db` Postgres instance. Keep Redis in the stack for its other two consumers (rate-limiting, short-lived job queues) — this decision is scoped to sessions only.

## Why now

Three facts forced this onto my desk this week:

1. The Redis cluster ran out of memory twice in the last 14 days (incident 4412, 4438). Both incidents were auth sessions eating 78%+ of the keyspace during traffic spikes.
2. We're adding SSO for two enterprise customers in Q2, which will ~3x our session payload size (more claims, longer tokens).
3. Marco's team is mid-migration away from self-hosted Redis toward ElastiCache anyway, and they'd prefer not to take on the auth sessions as a new customer during that transition.

## Trade-offs I'm accepting

- **Latency regression on session reads.** Current p99 for a Redis GET is ~1.2ms. Postgres with a pk index and a warm pool should land around 3–5ms p99 based on the benchmark I ran against `auth-db-staging` last Thursday (10k reads/s, see gist). That's a real regression on a hot path. I'm accepting it because session reads happen once per request after middleware caches the decoded token for 60s, so the user-perceived impact is bounded.
- **Write amplification.** Sessions are created on login and updated on refresh; Postgres will WAL-log each write. I expect ~400 writes/s at peak which is well within `auth-db`'s current headroom (it runs at ~15% write IO), but it eats some of the runway we had for other features on that instance.
- **Coupling sessions to the auth-db blast radius.** Today a Redis outage logs everyone out but leaves the auth DB alone. After this change, an `auth-db` outage logs everyone out *and* breaks login. I'm explicitly accepting this because `auth-db` already has to be up for login to work, so the practical blast radius is unchanged.

## Downstream effects & stakeholders

- **auth-svc team (me):** ~6 days of work, mostly a storage adapter and a dual-write backfill.
- **SRE (@marco):** one fewer Redis customer to migrate. Net positive. Needs to resize `auth-db` pool from 50 → 80 connections; he already confirmed this is fine.
- **Platform (@dana):** the session cleanup cron becomes a Postgres job. Dana's team owns our pg-cron harness; she'll need to onboard one new job.
- **Mobile team:** they rely on session TTL semantics. Postgres TTL via a partial index on `expires_at` + a sweeper is not identical to Redis EXPIRE — sweeps run every 60s, so expired sessions may linger up to 60s past their TTL. I've confirmed with @jess (mobile lead) that this is acceptable since the client already treats expiry as a hint and re-validates.
- **Security:** @sameer reviewed the threat model — no regression, and we actually gain a queryable audit trail for session creation.

## Pre-mortem — how this fails

1. **Connection pool exhaustion on auth-db.** If SSO traffic comes in hotter than projected, 80 connections may not be enough. *Mitigation:* PgBouncer is already in front of auth-db in transaction pooling mode, so we have elasticity. I'll add an alert at 70% pool utilization.
2. **The cleanup sweeper falls behind and the sessions table bloats.** *Mitigation:* partial index on `expires_at`, plus a hard kill switch to move to partitioned sessions table if dead tuples exceed 10M.
3. **Silent data loss during the dual-write backfill.** *Mitigation:* two-week dual-write window with daily reconciliation script. Cutover only after three consecutive clean reconciliations.
4. **Benchmark doesn't hold under real load.** My 10k/s test was synthetic and didn't include the full query pattern (refresh writes are heavier). *Mitigation:* shadow traffic through the new path at 5%, 25%, 50% before cutover.

## Reversibility

Medium-high. The Redis cluster stays provisioned for its other consumers, and the storage adapter is a thin interface. Rolling back is "flip the adapter flag, backfill last 24h of sessions from `auth-db` to Redis" — I estimate 2–4 hours including the incident bridge. We should not remove the Redis adapter code for at least 60 days post-cutover.

## Key uncertainty — what would change my mind

The thing most likely to make me reconsider is if Marco's team decides ElastiCache is fine for auth sessions after all and they want to take us on. If that happens, the entire justification (reduce Redis customers during migration) collapses, and we're left doing a latency-regression migration for no reason. **Decision gate:** I'll check in with Marco on Monday 04/14 before kicking off sprint work. If ElastiCache is viable for us within 30 days, we pause this and revisit.

## Ask

Sign-off from @marco and @dana by EOD Friday. If no response, I'll ping once and then assume lazy consensus per the team norm.

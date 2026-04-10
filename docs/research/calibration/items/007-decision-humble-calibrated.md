# Proposal: move bulk exports off the primary DB — looking for input

I'm bringing this to the team because I'm genuinely uncertain about the right answer and I don't want to commit us to a path I only half-understand.

## The problem, as I understand it

Bulk CSV exports (the "Download all transactions" feature in the dashboard) run queries against the primary Postgres. At p95 the query holds a row-level lock on `transactions` for about 8 seconds and occasionally spikes to 40+ seconds for large tenants. We had one customer (Brightforge) hit 2.5 minutes last week. The user-facing issue is that dashboard writes from the same tenant can queue behind these queries and cause the UI to feel sluggish during exports. I've confirmed this is happening via the slow query log, but I want to flag that I haven't been able to reproduce it cleanly in staging — the load pattern is hard to mimic, so my read of the problem is partly inference.

## What I'm proposing (tentatively)

Route bulk export queries to a read replica. We already have one provisioned for analytics. Adding the export service as a second consumer seems straightforward on paper.

## What I'm confident about

- The primary is the bottleneck for these specific queries. Query logs are unambiguous on this.
- The read replica has spare capacity. @marco confirmed current utilization is around 20%.
- Exports are tolerant of slight staleness. Product confirmed users expect exports to be "recent," not "real-time" — replica lag up to a few seconds is fine.

## What I'm less sure about

- **Whether replica lag stays bounded under the load we'd add.** I don't have a good mental model of how our streaming replication behaves when a new heavy reader joins. I've read the docs but I've never operated this system under stress, and I'd really like @marco or someone with Postgres ops experience to gut-check this. My guess is it'll be fine because the replica is on the same rack, but "my guess" is not a good basis for a decision that affects customer data freshness.
- **Whether there's a hidden consistency requirement I'm missing.** Exports include a "generated at" timestamp and customers sometimes use these exports for reconciliation with their own accounting systems. If replica lag causes an export to miss a transaction that was written right before the export started, is that a correctness problem for any customer? I don't know. I'd want @sara (who owns the reconciliation integrations) to weigh in.
- **Whether this is even the right solution.** An alternative I haven't fully investigated is async exports — enqueue the export, run it off a background worker against the primary with a lower priority, email the user a link when done. This is more work but it might be a better long-term answer because it also solves the "very large export blocks the browser" problem. I don't have strong evidence either way about which is better; I'm defaulting to the replica solution because it's a smaller change.

## What I'd like from you

Two specific things, not a general "thoughts?":

1. **@marco**: can you sanity-check the replica lag concern? Specifically, do we have telemetry on replica lag under the current analytics workload, and can I trust it to predict what happens when I add a second reader?
2. **@sara**: is there any customer contract or integration I'm not aware of that requires strict read-your-writes consistency on exports? I checked our docs and didn't find one, but I trust your knowledge of the customer side more than I trust the docs.

If the answer to both is "you're fine," I'll write the change up as a proper decision doc and move forward. If there are concerns on either, I'd rather pause and either reconsider the async-export path or dig deeper before committing.

I'm aware I'm asking for review before writing a full proposal, which isn't how we usually do it. I'd rather waste 15 minutes of your time here than waste a sprint on the wrong design.

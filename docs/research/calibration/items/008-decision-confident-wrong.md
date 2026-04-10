# Decision: consolidate all microservices into a single Django monolith

After looking at our architecture I've decided we're going to consolidate our 14 microservices back into a single Django application. This is clearly the right call and I want to explain why.

## The microservices experiment has failed

Let's be honest with ourselves. Microservices were a mistake from day one. Every serious engineer knows that Martin Fowler wrote about the "monolith-first" approach years ago and we ignored it. The result is exactly what you'd predict: distributed complexity, network latency on every call, and operational overhead that's crushing the team. The industry is clearly moving back toward monoliths — Shopify, Basecamp, and dozens of others have proven this works.

## Django is the obvious choice

Django will solve all of our current problems:

- **Speed**: in-process function calls are always faster than network calls. Our p99 latency will drop significantly.
- **Simplicity**: one deploy, one codebase, one test suite. New engineers will be productive in days instead of weeks.
- **Reliability**: fewer moving parts means fewer things to break. Distributed systems are inherently unreliable, monoliths are inherently reliable.
- **Cost**: we can shut down our Kubernetes cluster entirely and run the whole thing on 3 beefy VMs. This will cut our cloud bill by at least 70%.

Django specifically because it's the most mature Python web framework, it has everything built in (ORM, admin, auth, migrations), and it scales just fine — Instagram famously runs on Django and they serve billions of users. If it works for Instagram it will definitely work for us.

## Timeline

I'm planning an 8-week migration. That's two weeks per quarter of the codebase. This is aggressive but totally achievable if the team focuses. Here's the breakdown:

- Weeks 1-2: billing + payments → Django
- Weeks 3-4: inventory + catalog → Django
- Weeks 5-6: user service + auth → Django
- Weeks 7-8: everything else + cutover

We'll do a hard cutover on week 8. Running both systems in parallel would waste time.

## What we lose

Nothing meaningful. The "independent deploys" argument for microservices is overrated — in practice our teams coordinate deploys anyway because the services are tightly coupled in practice. The "team autonomy" argument is solved by good module boundaries, which we can enforce in Django with app boundaries. The "polyglot" argument doesn't apply because we only use Python and TypeScript anyway.

## Risks

None that can't be managed. The biggest concern is downtime during cutover, but we'll schedule it for a weekend and have a rollback plan (keep the old services up for 48 hours after cutover just in case).

I'm confident this is the right move. I'll start on the billing migration on Monday unless someone raises a blocker by EOD Friday.

# Memo: proposed shift to multi-region, for the exec review on Thursday

**To**: CEO, CFO, CTO
**From**: Platform engineering
**Re**: Should we go multi-region in H2?
**Length**: 2 pages. Skim the bold lines if you're short on time.

## TL;DR

**We should go multi-region in H2, starting with EU. Estimated cost: $180K one-time plus $65K/year ongoing. Primary benefit: unblocks the three enterprise deals currently stalled on data residency. Secondary benefit: reduces blast radius of the 2024-style outage we had in September.**

**Main risk: operational complexity doubles before it gets easier. We'll need to hire one additional SRE. If we can't hire by July, recommend deferring to Q4.**

---

## Why this memo, why now

We have three enterprise deals (combined ARR ~$2.1M) that have told us, on record, that they cannot sign without EU data residency. Sales has pushed back on the timeline twice; the third push is next month and I don't think we'll get another. Finance has asked me for a cost and risk assessment so you can decide whether to commit to the work at Thursday's review.

I'm writing this as a 2-page memo rather than a 20-page architecture doc because at this stage the decision is about commitment and capital, not technical design. The full architecture doc is linked at the bottom if you want to dig in, but you shouldn't need to for Thursday.

## The decision you're making

You're not deciding *how* to do multi-region. You're deciding whether to commit the money and hire the person to make it possible. The technical approach is well-understood; the hard part is organizational.

## Costs

| Item | One-time | Annual |
|---|---|---|
| Infra (EU region stand-up) | $120K | $45K |
| One additional SRE (burdened) | — | $180K |
| Data residency audit & compliance | $40K | $8K |
| Tooling (monitoring, deploy pipelines) | $20K | $12K |
| **Total** | **$180K** | **$245K** |

The annual figure includes the new hire. If we don't hire and instead stretch the existing team, we save $180K/year but take on operational risk I do not recommend (see "Risks" below).

## Benefits

- **Unlocks ~$2.1M ARR** from the three stalled deals (sales has confidence on two, moderate on the third). Payback period: ~3 months after close.
- **Pipeline signal**: at least four more EU prospects have mentioned data residency in discovery. We're not tracking this well yet — I'll ask sales ops to add it to the CRM.
- **Reduced blast radius**: when US-East went down in September, we lost 4 hours of availability. With multi-region we'd lose partial availability for minutes, not hours.
- **Regulatory headroom**: GDPR is the immediate driver, but India's DPDP and Brazil's LGPD are on the horizon. This work positions us for those.

## Risks

1. **Hiring risk** (highest). SRE hiring for multi-region experience takes 2-4 months in this market. If we commit to the work before the hire closes, we put the existing team into a known burnout scenario. Mitigation: make the hire a blocker — if we don't have the person by July 1, we defer the project to Q4.

2. **Operational complexity doubles** before it gets easier. The first 3 months of multi-region are strictly worse than single-region in every operational metric. This is unavoidable and we should set expectations with the board accordingly.

3. **Data consistency** across regions is the hardest technical problem. We have a plan (per-tenant pinning, with cross-region only for analytics), but it constrains product choices for the next year. Product team is aware and aligned.

4. **Cost creep**. $245K/year is a conservative estimate. Historical multi-region projects at comparable companies have averaged ~1.4x initial estimate. I'd budget $350K/year for safety.

## What I need from you on Thursday

1. **Go/no-go** on committing the $180K one-time budget.
2. **Approval to open the SRE req** this week (so we have a chance of closing by July).
3. **Alignment on the hiring constraint**: if we don't hire by July 1, we defer the project. I need to know you agree with this constraint so I'm not pressured to proceed without the hire.

## What I do NOT need from you on Thursday

- Architectural choices. These are engineering's call and the full architecture doc is below for reference.
- Cloud vendor negotiation. I'll take that on myself after the go decision.

## Appendix: what I'm uncertain about

- Whether the third deal will actually close. Sales gives it 50/50. If it falls through, the business case is still positive on the other two, but the margin is thinner.
- Whether we can do this with one SRE or will need two within 18 months. I'm budgeting for one with the honest caveat that I may come back for another by end of Q1 next year.

---

Full architecture doc: [link]
Cost model spreadsheet: [link]
Sales pipeline data: [link]

Happy to answer questions async before Thursday or walk through any section in person.

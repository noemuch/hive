# A friendly guide to our new subscription billing system for the customer support team!

Hi team! I'm so excited to share the new billing system with you all. I know billing changes can be a little intimidating, but don't worry — I'm going to walk you through everything you need to know, and by the end of this doc, you'll be experts! Let's dive in!

## What is the new billing system?

The new billing system is a complete ground-up rewrite of our subscription management infrastructure, built on an event-sourced architecture using Kafka as the event bus and a Postgres-backed projection layer for read models. We've moved from a CRUD-based model to a CQRS pattern where commands mutate an append-only event log and queries hit materialized views that are eventually consistent with the write side. This gives us much better auditability and makes reconciliation significantly easier, especially for edge cases like mid-cycle plan changes, proration, and dunning flows.

## The event model

At the core of the new system is the `SubscriptionEvent` aggregate, which is a discriminated union of roughly 40 event types. Here are the key ones you should know about:

- `SubscriptionCreated` — emitted when a new subscription is provisioned. Carries the initial plan_id, billing_cycle_anchor, trial_end, and a denormalized snapshot of the pricing schema at creation time (important for grandfathering).
- `SubscriptionItemAdded` / `SubscriptionItemRemoved` — for usage-based line items. These emit proration events downstream via the `ProrationCalculator` service, which applies our new proration policy (see RFC-0142 for the math).
- `PaymentIntentSucceeded` / `PaymentIntentFailed` — bridged in from the Stripe webhook listener via the `BillingEventMapper`. Note that these are *not* the same as Stripe's internal events; we re-emit them into our own bus with our own schema to decouple our consumers from Stripe's API surface.
- `DunningCycleAdvanced` — emitted by the `DunningOrchestrator` when a failed payment progresses through the retry schedule. The schedule is configured via the `DunningPolicy` aggregate which itself is event-sourced.

The read side exposes materialized views via the `SubscriptionProjection` table, which is updated by a dedicated projector process. The projector has at-least-once semantics with idempotency keys derived from the event ID, so if you see duplicate events in the raw log it's probably because we replayed a window — check the `projector_checkpoints` table to confirm.

## Handling customer inquiries

When a customer writes in about their bill, you'll want to query the `SubscriptionProjection` table joined with `invoices` and `payment_attempts`. The easiest way is to use the new `billing-cli` tool:

```bash
billing-cli inspect --subscription-id sub_abc123 --include-events --since 30d
```

This will dump the full event stream for the subscription, with projections applied at each step. If the projection lags (which can happen during a Kafka rebalance), you may see a stale read — in that case, force a projection rebuild with:

```bash
billing-cli projection rebuild --subscription-id sub_abc123 --from-offset earliest
```

If the rebuild fails with `IdempotencyConflict`, it means there's a duplicate event in the log (rare but possible during Kafka partition migrations). In that case you'll need to manually reconcile by running:

```bash
billing-cli events dedupe --subscription-id sub_abc123 --strategy last-write-wins
```

## Common scenarios

**Customer asks why they were charged $X.** Run the inspect command above, find the most recent `InvoiceFinalized` event, and trace back through the `InvoiceLineItemAdded` events that built up the invoice. The proration math is explained in RFC-0142 appendix B.

**Customer wants a refund.** Refunds go through the `RefundCommand` handler, which emits a `RefundIssued` event that propagates to Stripe via the `StripeRefundAdapter`. Make sure to set the `reason_code` enum correctly — it affects our chargebacks dashboard. Valid values are in `src/billing/events/refund_reasons.ts`.

**Customer complains about a failed payment.** Check the `PaymentIntentFailed` event for the decline code, cross-reference with our dunning policy state, and see where they are in the retry schedule. If they're past the final retry, they'll be in the `subscription_cancelled_for_nonpayment` state and you'll need to manually reinstate via the `ReinstateSubscriptionCommand`.

## That's it!

I hope this helps! As always, feel free to reach out if you have any questions. The full architecture doc is in the engineering wiki (you'll need a GitHub account with repo access to view it), and the codebase is open for anyone who wants to dig in. Happy supporting! 💜

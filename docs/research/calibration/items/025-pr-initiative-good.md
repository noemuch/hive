# Fix stale cache in `OrderSummary` + unrelated cleanup (see note)

## Primary change — OrderSummary cache key

Fixes #6120. The `OrderSummary` component was using `orderId` alone as its SWR cache key, so when a user edited line items and the backend returned a new revision, the component would briefly flash the old totals before re-fetching. I've changed the key to `[orderId, order.revision]` which fixes the flash.

Straightforward fix, tests added.

## Secondary change — tangential cleanup I want to flag

While tracing the bug, I noticed that `useOrderSummary` was also being called by `InvoicePreview` with a stale-closure pattern that would have hit the same class of bug the moment anyone edited invoice line items. It's not currently reported as a bug because `InvoicePreview` is only opened from a modal that remounts on close, which masks it — but as soon as someone tries to use that component inline (which is on the Q3 roadmap per @tasha), it would have broken in the same way.

I considered three options:

1. **Fix only #6120 and file a follow-up ticket** for the `InvoicePreview` issue. Cleanest scope-wise, but the follow-up might sit in the backlog and bite us in Q3.
2. **Fix both, put the invoice fix behind a flag**. Overkill for what is functionally a one-line cache-key change.
3. **Fix both in this PR, flag it clearly**. What I did.

I chose (3) because the fix is literally the same one-line pattern applied to the second call site, the risk is symmetric (either both work or both are broken), and deferring it would have created a hidden trap for the Q3 work. I've kept the two changes in separate commits so you can revert the invoice one independently if you disagree.

If you'd rather I split this into two PRs, I'll do that — no pushback. I'm flagging the expansion of scope explicitly because I know unsolicited refactors in a bugfix PR are annoying.

## Test plan

- Unit tests for both cache keys
- Manual repro of #6120 — confirmed flash is gone
- Manual test of `InvoicePreview` inline (temporarily mounted without the modal) — confirmed the latent bug and that my fix resolves it

cc @tasha since this touches the Q3 invoice work.

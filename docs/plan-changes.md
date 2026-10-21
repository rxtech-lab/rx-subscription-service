# Plan changes

`POST /api/v1/plan-changes` requires `checkout.create` and checkout user authentication. Body: `rxlabUserId`, local `subscriptionId`, target `planId`, absolute `returnUrl`, and `timing` (`immediate` by default, or `next_period`). Returns `{ "url": "https://...stripe.com/..." }` for hosted review. Opening the URL alone does not change or schedule a plan.

| Current plan | Requested change | Behavior |
| --- | --- | --- |
| Automatic free or zero-price Stripe | Upgrade now | Checkout or Stripe confirmation starts paid access after confirmation |
| Free | Upgrade next period | Save payment method now; schedule starts at the free plan's existing period end |
| $10 | $20 mid-period | Immediate Stripe proration; approximately $5 for exactly half a period, before tax/discounts |
| $10 | $20 next period | Keep $10 access until renewal; $20 begins and is billed then |
| $20 | $10 mid-period | Refused, without creating a review session or changing billing/access |
| $20 | $10 next period | Keep $20 access until renewal; $10 begins and is billed then |

Active/trialing, automatically collected, single-item Stripe subscriptions and automatic internal zero-price plans are supported. Plans must be active recurring plans in the same application, group and currency. One-time purchases, store/complimentary subscriptions, past-due states, cancellations, existing schedules and pending changes are refused. Immediate downgrade detection uses the actual Stripe price rather than a possibly edited catalogue price.

Immediate paid upgrades use `always_invoice`. Stripe displays the actual proration and handles payment authentication. Free-to-paid switches can reset the billing anchor; the hosted review is authoritative.

Deferred changes use Checkout `mode=setup`: no plan charge or new access is granted during setup. A signed completed setup webhook validates the customer, source period and immutable target price, locks the source subscription, and creates an idempotent Stripe schedule. An existing Stripe subscription keeps its old-price phase until renewal. An automatic free plan gets a future-start schedule. The selected payment method is used for the future phase. Pending details are stored in the existing entitlement snapshot and exposed without provider IDs. Pending free upgrades reserve the plan group; only their matching schedule/target can replace it at activation. No schema migration is needed.

Return navigation is not proof of payment or scheduling. Price-based subscription webhooks update access only when Stripe enters the new phase. Existing credits are retained; the new plan's normal period allowance is granted when that plan becomes effective, not at payment-method setup. Immediate upgrades retain the existing full per-plan/per-period credit-grant policy.

Local coverage includes all six request paths, deferred phase boundaries, no early access, abandonment, failed setup, changed prices, duplicate delivery, retries, group reservation, and real SDK HTTP simulation. Simulation uses fixture database state and a controlled provider clock; it is not evidence of live Stripe charges. Verify sandbox payment/3DS, the actual proration invoice, scheduled renewal, and signed webhook delivery before production.

Deploy this backend before McpRouter. Run `bunx next typegen && bun run typecheck`, `bunx vitest run lib/stripe/plan-change.test.ts lib/stripe/deferred-plan-change.test.ts lib/stripe/plan-sync.test.ts lib/subscription/plan-group-pending.test.ts`, and the documented simulation in the companion McpRouter repo.

# Plan changes

`POST /api/v1/plan-changes` requires the `checkout.create` scope and the same user authentication as checkout. Body: `rxlabUserId`, local `subscriptionId`, target `planId`, and absolute `returnUrl`. Returns `{ "url": "https://billing.stripe.com/..." }`. Opening the URL does not mutate the subscription; the user reviews and confirms with Stripe.

Only active/trialing, automatically collected, single-item Stripe subscriptions can change to a different active recurring, non-automatic plan in the same application, group and currency. One-time purchases, store subscriptions, complimentary access, scheduled cancellations, schedules, pending changes and past-due subscriptions are refused. Automatically assigned internal defaults continue to use new checkout instead.

The isolated portal configuration permits only the selected price and uses `always_invoice` proration. Stripe displays the actual billing effect and handles payment authentication/failures. Return navigation is not proof of payment or of a change. Webhooks read current Stripe state, resolve the plan from price metadata, and update the existing subscription's plan and entitlement snapshot. Period grants retain their existing per-plan/per-period idempotency keys; existing credits are not revoked.

Deploy this service before the McpRouter change-plan UI. Existing keys need `checkout.create`. Run `bun run typecheck` and `bunx vitest run lib/stripe/plan-change.test.ts` locally, then verify sandbox review, cancellation, payment authentication/failure, and webhook delivery before enabling in production.

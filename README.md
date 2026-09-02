# rx-subscription

A shared subscription, billing, and usage layer for rxlab applications. One
deployment serves every app: each has its own plans, topups, roles, permissions,
balance units, and usage items, and each user gets independent balances per app.

- **Next.js 16** App Router, server actions for the console
- **Turso / libSQL + Drizzle** for storage
- **Stripe and Apple StoreKit 2** for payments
- **@rxtech-lab/authjs-rxlab** for admin sign-in; applications come from
  rxlab-auth's admin OAuth-client API
- **AI SDK 6 + Vercel AI Gateway** for the assistant

## Setup

```bash
bun install
cp .env.example .env.local     # fill in the values
bun run db:migrate             # apply migrations
bun dev
```

Without `AUTH_*` set the app boots and explains what is missing rather than
failing during an OAuth callback.

## Authorization

There is no second permission system. Signing in yields an rxlab access token,
which is used to call `GET /api/admin/oauth-clients` on rxlab-auth — whatever
comes back is exactly the set of applications you may manage, per your
`read:oauth_clients:all` or `read:oauth_clients:<ids>` grant. Every server action
and AI tool re-checks that before touching anything.

> The client list is fetched with the signed-in admin's token because rxlab-auth
> resolves the token `sub` against its `users` table
> (`lib/admin-api/authorize.ts`), while a `client_credentials` token carries the
> client id as `sub` (`app/api/oauth/token/route.ts:454`). Machine-to-machine
> access to that endpoint is therefore not possible today; syncing happens during
> an admin request instead.

## Concepts

| Concept | What it is |
|---|---|
| **Application** | An rxlab OAuth client. Its client id is the primary key here. |
| **Balance unit** | What you meter — points, credits, anything. Integer amounts, with an exact integer conversion to money. |
| **Plan** | Monthly, quarterly, yearly, or one-time. Grants roles, permissions, usage allowances, and balances. |
| **Topup** | A purchasable bundle of units, optionally gated behind a plan or role. |
| **Coupon** | An application-scoped discount code for selected plans or topups, with optional user and redemption restrictions. |
| **Subscription role** | What a subscriber *bought* — distinct from rxlab-auth's `oauth_client_roles`, which describe who someone *is*. |
| **Permission** | A customizable action, serialized as `read:a:all` or `read:a:id1,id2` — the same syntax rxlab-auth uses. |
| **Usage item** | Something counted per user, with its own reset schedule and overage policy. |

Plan usage grants can set separate trial and non-trial allowances. The trial
allowance applies only while the subscription status is `trialing`; existing
grants continue to use their regular allowance for both states.

### Usage resets

Counters are never reset by a scheduled job. Asking for the current period is
what rolls a lapsed one over, so a reset is exact at any granularity and an idle
user accumulates no rows.

| Policy | Behaviour |
|---|---|
| `never` | Accumulates forever |
| `rolling_window` | N hours/days/weeks/months from first use |
| `calendar_period` | Snapped to clock boundaries (UTC midnight, Monday, 1st of month) |
| `billing_period` | Follows the subscription; falls back to calendar months |

Over the limit, an item can `block`, `allow`, or `charge_balance` at a set cost
per extra unit.

### Plan edits and existing subscribers

A subscription stores a snapshot of what its plan granted at purchase, so editing
a live plan never retroactively changes what someone already paid for. Price
changes mint a new Stripe Price; existing subscriptions keep billing on theirs.

## Machine API

Your applications talk to `/api/v1` with an environment-scoped application API
key (`X-Api-Key`, created under Settings). The endpoint URL stays the same; the
key selects the data plane:

- **Sandbox** keys create and resolve isolated test users, use the Stripe sandbox
  account, and never read or mutate the matching production user's balances,
  usage, purchases, subscriptions, or reservations.
- **Production** keys create and resolve real users and use live Stripe. Keys
  created before environment support are migrated to production.

The same `rxlabUserId` may exist in both environments. API keys cannot be moved
between environments after creation; rotate a key if its environment changes.

### Two kinds of key

A key's *kind* decides what it may do and how it names its user. Kind is fixed
at creation, like environment.

|  | **Secret** `rxs_{env}_…` | **Publishable** `rxs_pk_{env}_…` |
|---|---|---|
| Where it lives | your backend, only | inside a client binary |
| Extra credential | none | **required**: the end user's rxlab access token, as `Authorization: Bearer` |
| Which user it acts for | whichever `rxlabUserId` the request names | the `sub` of the verified token; a request naming anyone else is refused with `403 user_mismatch` |
| Reach | every endpoint | reads and purchases only (see below) |

A secret key can credit any balance for any user, so shipping one inside an app
is the same as publishing a coupon generator. That is what publishable keys are
for. On its own a publishable key authenticates nothing — without a user token
the request fails with `401 missing_user_token` — and it accepts tokens only
from the OAuth clients listed when it was created, so a key extracted from your
iOS app cannot be replayed through some other client.

Publishable keys reach: `catalog`, `paywall`, `entitlements`, `usage` (read),
`usage/statistics`, `balances` (read), `balances/ledger`,
`balances/consumption`, `invoices`, `purchases`, `coupons/validate`,
`checkout`, and the three `iap/apple/*` endpoints. Everything else — crediting
a balance, recording usage, and the whole reservation family — answers
`403 insufficient_key_scope`. The statistics endpoints also drop their
application-wide mode: a publishable key always sees its own user's series.

Submitting a StoreKit transaction *is* allowed, because the App Store signs it
and this service verifies that signature. A forged call cannot invent a
purchase.

Set `AUTH_ISSUER` before creating a publishable key — it names the issuer whose
JWKS verifies user tokens.

```bash
# From your backend
curl "$BASE/api/v1/entitlements?rxlabUserId=$USER" -H "X-Api-Key: $SECRET_KEY"

# From your app
curl "$BASE/api/v1/entitlements" \
  -H "X-Api-Key: $PUBLISHABLE_KEY" \
  -H "Authorization: Bearer $USER_ACCESS_TOKEN"
```

The iOS client for this is [RxSubscriptionIOS](https://github.com/rxtech-lab/RxSubscriptionIOS),
which takes a publishable key and a closure that hands it a fresh access token.

| Endpoint | Purpose |
|---|---|
| `GET /api/v1/entitlements` | Plans, roles, permission expressions, balances, and usage in one call |
| `GET/POST /api/v1/usage` | Read or report metered usage |
| `GET/POST /api/v1/balances` | Read, credit, or debit a balance |
| `GET /api/v1/invoices` | Stripe-authoritative invoice history, including subscription renewals |
| `POST /api/v1/balances/reserve` | Atomically hold available balance for an in-flight operation |
| `GET /api/v1/balances/reservations` | Recover a reservation by its caller idempotency key |
| `GET /api/v1/balances/reservations/:id` | Read a reservation and its running settlement totals |
| `POST /api/v1/balances/reservations/:id/increase` | Grow an open hold and renew its TTL |
| `POST /api/v1/balances/reservations/:id/settle` | Incrementally charge a hold; optionally close it with `final: true` |
| `POST /api/v1/balances/reservations/:id/release` | Close an operation and release its remaining hold |
| `GET /api/v1/balances/ledger` | Paginated, application-scoped balance history |
| `GET /api/v1/purchases` | Paginated local one-time purchase and fulfillment history |
| `GET /api/v1/catalog` | Purchasable plans and topups, with per-user eligibility and per-platform prices |
| `GET /api/v1/paywall` | The application's published paywall as a layout tree, with its plans filled in |
| `POST /api/v1/coupons/validate` | Validate an app-local coupon for a user and plan or topup before checkout |
| `POST /api/v1/checkout` | Stripe Checkout for a plan or topup, with an optional `couponCode`, or the billing portal |
| `POST /api/v1/iap/apple/account-token` | Get the stable environment-specific StoreKit `appAccountToken` for a user |
| `PUT /api/v1/iap/apple/consumption-consent` | Store or withdraw refund-review consumption-data consent |
| `POST /api/v1/iap/apple/transactions` | Verify, reconcile, and fulfill a StoreKit 2 signed transaction or restore |

### Paywalls

The console's **Paywalls** section is a shared library of paywall templates.
Each application picks one on its Paywall page, and `GET /api/v1/paywall`
returns the last *published* version of that template — drafts never reach an
app. The response is a nested layout tree named after SwiftUI and Compose
primitives (`ScrollView`, `VStack`, `HStack`, `ZStack`, `Grid`, `List`,
`TabView`) with leaf nodes (`Text`, `Image`, `Button`, `Badge`, `FeatureRow`,
`Link`, `Spacer`, `Divider`, `ProductList`), each carrying optional `modifiers`
(padding, frame, background, cornerRadius, border, opacity, hidden). A
`TabView` draws a tab bar from its `tabs` and shows one child at a time — tab
*n* is child *n* — so monthly and yearly offers can each get their own page.
Every `ProductList` arrives with `products` already filled from the
application's active plans — including the StoreKit `productId` where one is
mapped — and a `highlightedProductId`. Its `periodOptions` are the period
switcher (monthly, yearly, one-time), each option naming the `productIds` it
shows and the product to preselect; the array is empty when the list has no
period filter.
A StoreKit client is labelled with App Store prices automatically — both this
endpoint and `catalog` resolve the platform from `?platform=`, an `X-Platform`
header, or the user agent, and name the result as `platform` in the response.
Buttons carry one of five actions: `purchase`, `restorePurchases`, `dismiss`,
`openUrl`, or `selectProduct`. A client renders the tree natively; nothing in it
needs evaluating.

```bash
curl "$BASE/api/v1/paywall" \
  -H "X-Api-Key: $PUBLISHABLE_KEY" \
  -H "Authorization: Bearer $USER_ACCESS_TOKEN"
# => 404 paywall_not_configured until a published template is assigned
```

Use `invoices` for customer-facing receipts and renewals from Stripe. Use
`purchases` when the application needs RxArgo's local fulfillment state; a paid
invoice with a still-pending purchase means the matching webhook has not been
processed yet.

```bash
curl "$BASE/api/v1/entitlements?rxlabUserId=$USER" -H "X-Api-Key: $SANDBOX_KEY"
```


```json
{
  "roles": ["free", "pro"],
  "permissions": ["read:a:all"],
  "usage": [{ "key": "api_calls", "used": 4, "limit": 1000, "remaining": 996,
              "resetsAt": "2026-08-19T00:00:00.000Z" }],
  "balances": [{ "unit": "points", "amount": 700, "available": 700 }]
}
```

Credits, debits, and topup fulfillment are idempotent on a caller-supplied key,
so a retried request or a replayed webhook can never double-charge. Balance
debits are a single conditional update, so concurrent spends cannot overdraw.

Reservations use the same conditional-update discipline. They default to a
30-minute TTL (overridable up to 24 hours), expire lazily on balance or
reservation access, and renew their original TTL after every partial settlement
or increase. Each settlement writes one `usage` ledger row and leaves the hold
open unless `final: true`; releasing closes it without another charge. A late
settlement against an expired hold becomes a capped debit of currently available
funds and reports its shortfall with `status: "expired"`.

## Stripe

Point a webhook at `/api/stripe/webhook` for `checkout.session.*`,
`customer.subscription.*`, `invoice.paid`, `charge.refunded`, and
`charge.dispute.*`. Events are claimed in a dedupe table before processing, so
Stripe's retries are safe. Topup eligibility is re-checked at fulfillment, not
just at checkout, so a plan cancelled mid-payment cannot unlock a gated pack.

## App Store in-app purchases

Apple purchases use StoreKit 2 and the official App Store Server Node library.
Configure the shared issuer, key ID, base64 `.p8` key, and Apple root
certificates in deployment secrets. Configure each application's bundle ID and
numeric Apple app ID under **Settings → App Store**, then map an App Store
Connect product ID on each plan or top-up. API keys support `xcode`, `sandbox`,
and `production`, with Xcode selected by default when creating a key. Product
IDs are shared across all three; the API key environment must match the
environment in StoreKit's signed data.

The `xcode` environment accepts transactions produced by an active Xcode
StoreKit configuration. Those transactions are kept in their own user and
idempotency data plane, never call the App Store Server API, and use Stripe test
mode for any non-StoreKit checkout. Xcode does not send App Store Server
Notifications, so renewals, expiration, and restore state arrive through the
app's `Transaction.updates` and `Transaction.currentEntitlements` submissions.
Apple's server library does not cryptographically verify Xcode JWS payloads;
use this environment only for local development data, never production value.

The StoreKit client sequence is:

1. Call `POST /api/v1/iap/apple/account-token` and attach the returned UUID as
   `appAccountToken` to `Product.purchase`.
2. After StoreKit verifies the result locally, send
   `Transaction.jwsRepresentation` to `POST /api/v1/iap/apple/transactions`.
3. Wait for successful server fulfillment, then call `finish()` on the StoreKit
   transaction. Send restored transactions through the same endpoint.

Set App Store Server Notifications to the exact Notifications V2 URL shown in
the application's App Store settings. Notifications are signature-verified
before acknowledgement, claimed in a durable event inbox, and replay-safe.
Hourly reconciliation overlaps its notification-history cursor and rechecks
active subscriptions so a missed notification cannot permanently drift access.

Auto-renewable subscriptions map by Apple's `originalTransactionId`; grace
period keeps access, billing retry becomes `past_due`, expiry ends access, and
revocation removes it immediately. Non-consumable plans retain a frozen
entitlement snapshot. Consumables multiply the top-up grant by StoreKit
quantity. Refunds reverse each transaction's grants and may make a spent balance
negative; refund reversals restore the same grants idempotently.

Consumption information is sent only while the user has explicitly consented.
For consumables, the consumed percentage is derived from the balance lot opened
by that exact transaction. See [Apple's sandbox testing documentation](https://developer.apple.com/documentation/storekit/testing-in-app-purchases-with-sandbox)
for account and renewal testing. Legacy receipts, Notifications V1, Family
Sharing, promotional-offer creation, and price management are intentionally out
of scope. Google Play is reserved in the provider schema and adapter contract,
but has no credentials, verification code, notification endpoint, or public API
in this release.

Every plan belongs to a plan group, defaulting to `default`. A user can own one
active or in-progress plan in each group: repeat purchases of the same plan and
purchases of another plan in the same group are rejected, while plans in
different groups can be combined. The console and assistant can change a plan's
group.

Two accounts run side by side: `live` for real subscribers and `sandbox` for
test users. Stripe ids are per-account, so plans and topups store a second
product/price pair for the sandbox; `lib/stripe/accounts.ts` owns which account
a call belongs to and which columns go with it.

### Coupons

Coupon codes belong to one application even when several applications share a
Stripe account. Checkout resolves a submitted `couponCode` against the calling
application and applies the resulting Stripe Coupon directly. When a code is
not pre-applied, Checkout enables its promotion-code field only if the user has
an eligible app coupon, mirrored as a customer-specific Stripe Promotion Code.

Coupons support fixed or percentage discounts, an optional maximum discount,
one-time or repeating durations, selected plans/topups, user allow-lists,
first-purchase and minimum-order rules, total/per-user redemption limits, and
start/end dates. Uses are reserved atomically before Stripe Checkout is created,
released when an uncompleted session expires, and settled idempotently from
webhooks. The console and assistant use the same service-layer validation.

## Test users

The **Test** tab creates disposable users for walking through the subscriber
experience. They are ordinary `app_users` rows flagged `is_test`, so balances,
usage, entitlements, and subscriptions all behave exactly as they do for a real
subscriber — but they are hidden from the Users tab and from the dashboard
counts, tagged wherever they do surface, and they transact against a **separate
Stripe sandbox account** (`STRIPE_SANDBOX_SECRET_KEY`), never the live one. A
test user needs no RxLab identity; a synthetic `test:<uuid>` one is generated.

"Test user" in a row's menu opens `/test/<appId>` in a new tab as that user: a
plain storefront showing their entitlements, balances, and usage, with plans and
topups they can actually buy. Authorization is a signed, httpOnly, 8-hour cookie
minted by a console-authenticated route, and every request re-checks that the
named user still exists and is still a test user.

Point the sandbox account's webhook at `/api/stripe/webhook/sandbox`, which uses
`STRIPE_SANDBOX_WEBHOOK_SECRET`. The storefront's return page also reconciles the
Checkout session directly, so purchases still settle without a webhook tunnel;
both paths are idempotent.

It can also write and run suites: `listTestSuites`, `getTestSuite`,
`saveTestSuite`, `runTestSuite`, and `getTestRun`. A run it starts appears in
the chat as a live card — the same diagram the Test cases tab shows — and the
model reads the outcome with `getTestRun` rather than reporting a result it has
not seen.

The assistant can manage test users (`listTestUsers`, `createTestUser`,
`grantTestSubscription`, `adjustTestUserBalance`, …). Test users are the only
users whose balances and subscriptions it can change — every write resolves the
id through `requireTestUser`, so an approved call naming a real subscriber is
refused server-side.

## Test cases

The Test tab's second half holds **suites**: TypeScript files that exercise this
application end to end — subscribe, buy a topup, spend a balance, cross a usage
limit — written in the console and run on demand. The tab lists them with their
latest result; opening one gives you the editor, the flow, and the Run button.

A suite has no imports. `suite`, `test`, `step`, `expect`, `sleep`, and `rx` are
globals, declared in `lib/testing/sdk-types.ts`; that one string is loaded into
Monaco as an ambient library *and* embedded in the assistant's prompt, so the
editor, the runtime, and the model all work from the same declarations.

```ts
suite("Topup eligibility", () => {
  test("a free user cannot buy the pro-only pack", async () => {
    const user = await step("create a user", () => rx.testUsers.create());
    const catalog = await rx.catalog(user.rxlabUserId);
    expect(catalog.topups.find((t) => t.key === "pro_pack")?.eligible).toBe(false);
  });
});
```

Coupon suites can discover configured codes with `rx.config.coupons()`, preview
one through the public API with `rx.coupons.validate()`, and atomically hold a
use with `rx.coupons.reserve()`. The reservation follows Checkout's real limit
logic without creating a Stripe session, so total and per-user redemption limits
stay deterministic and the row disappears with the disposable test user.

Test-user time is persisted in the database. `rx.testUsers.setTime()` moves to
an absolute timestamp and `advanceClock()` jumps by milliseconds; both usage
reset periods and coupon start/expiry windows read that simulated time. Leaving
the suite detail page and reconnecting therefore reads the same clock and the
same saved run/event history rather than restarting a timer in the browser.

The panel beside the editor is a diagram of the file, scanned from the source as
you type (`lib/testing/outline.ts`) and taken over by live status once a run
starts — the same component the assistant's chat card renders.

Suites are type-checked on save (`lib/testing/typecheck.ts`), against those same
declarations. The rule is asymmetric on purpose: a human already has the errors
in front of them, so the save goes through and reports a count, while the
assistant — which never sees a squiggle — has the write refused and gets the
diagnostics back as the tool result to retry from.

### How a run executes

A suite is arbitrary code, so it never runs in the request process. The runner
ships it plus `lib/testing/harness/runner.js` into a **Vercel Sandbox** and
speaks a line protocol back over stdout (`lib/testing/protocol.ts`). Off Vercel
there are no sandbox credentials, so it runs as a child process of the dev
server instead — a convenience, not isolation, and `TEST_RUNNER=local` is
refused in a deployment.

| Variable | Purpose |
|---|---|
| `TEST_RUNNER` | `sandbox` or `local`. Defaults to `sandbox` on Vercel, `local` off it. |
| `TEST_RUNNER_BASE_URL` | The URL a run calls back on; defaults to `NEXT_PUBLIC_SITE_URL`. A sandbox is a separate machine, so exercising that driver from a laptop needs a tunnel — pointing it at `localhost` fails before the run starts rather than during it. |

The sandbox holds two credentials, both minted for one run and dead when it
ends: an application API key for `/api/v1`, and a signed token for
`/api/testing/control`, which covers what the public API deliberately does not —
creating a test user, granting a plan without paying, moving a clock. Every
control operation resolves its target through `requireTestUser`, so a suite
naming a real subscriber is refused server-side. Users a run creates are deleted
when it finishes unless it calls `rx.keepTestUsers()`.

Starting a run and watching one are separate: the server action queues it and
whoever displays it claims it with a conditional update, so the tab, the chat
card, and a reload all follow the same event log without racing to execute it.

Events carry a sequence number assigned by the single claiming executor, not
derived from `max(seq) + 1` per write. A run emits its lines in bursts, and
deriving the number per call is a read-modify-write that two concurrent appends
both win — which collides on the unique index and, before this was fixed, left
the run sitting at "running" forever.

## The assistant

The button in the bottom-right of any application opens a chat that can add,
edit, and list subscription settings in plain language. Read tools run
immediately. A minimal HMAC-signed confirmation card handles simple decisions
without requiring a typed reply, while every write tool retains its existing
signed approval. Writes go through the same service layer as the console and
are recorded in `audit_logs` with `actorType: "ai"` and the originating
conversation.

## Development

```bash
bun run typecheck
bun run test
bun run db:generate     # after changing lib/db/schema/*
bun run scripts/seed-demo.ts   # seed a demo app and print an API key
```
</content>

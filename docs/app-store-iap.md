# App Store Connect setup

RxArgo supports StoreKit 2 auto-renewable subscriptions, non-consumable plans,
and consumable balance top-ups. Apple is authoritative for billing state,
prices, currency, taxes, and refunds; local prices remain catalog metadata.

## Shared server credentials

Create one In-App Purchase key for the RxLab issuer in App Store Connect. Store
the issuer ID and key ID as `APPLE_IAP_ISSUER_ID` and `APPLE_IAP_KEY_ID`. Base64
encode the complete downloaded `.p8` file as `APPLE_IAP_PRIVATE_KEY_BASE64`.
Never put the private key in Turso, client code, or a public environment
variable.

Download Apple's current root certificates, convert them to DER if needed, and
put their base64 values in `APPLE_IAP_ROOT_CERTIFICATES_BASE64`, either as a
comma-separated list or JSON string array. Online certificate revocation checks
are enabled by the verifier.

## Application and products

In **Settings → App Store**, enter the exact bundle ID and numeric Apple app ID.
Copy the displayed Notifications V2 URL into App Store Connect. Leave the
integration disabled until the shared credentials and product mappings are
ready.

Use the App Store product action on each plan or top-up. Recurring plans require
an Auto-Renewable Subscription, one-time plans require a Non-Consumable, and
top-ups require a Consumable. One Apple product ID maps to one local item.

## StoreKit client

For the signed-in RxLab user, request an account token from
`POST /api/v1/iap/apple/account-token`. Pass that UUID to StoreKit as
`appAccountToken`. Submit the verified transaction's `jwsRepresentation` and
the same `rxlabUserId` to `POST /api/v1/iap/apple/transactions`. Call
`Transaction.finish()` only after that request succeeds. Restoration enumerates
current StoreKit entitlements and submits each JWS through the same endpoint.

Sandbox API keys create separate test users and account tokens. Production keys
create production users and tokens. A signed environment mismatch is rejected.
The E2E fake adapter accepts `e2e.` payloads only when `IS_E2E=true`; production
always uses Apple's certificate-chain verification.

Ship a **publishable** key in the app, not a secret one — see "Two kinds of
key" in the README. All three `iap/apple/*` endpoints accept it, provided the
request also carries the signed-in user's rxlab access token. In that mode
`rxlabUserId` comes from the verified token, so the value in the body is only
checked for agreement; a mismatch is a `403` rather than a silent redirect to
somebody else's account.

## Refund review and recovery

Apps must obtain explicit user consent before setting it through
`PUT /api/v1/iap/apple/consumption-consent`. RxArgo sends consumption data only
while that stored consent remains true. Notification failures stay retryable;
hourly reconciliation replays an overlapping notification-history window and
rechecks active subscriptions. The event UUID, transaction ID, renewal period,
and balance mutations all have independent idempotency guards.

Refunds and revocations reverse the grants from the exact transaction. If the
user already spent consumable units, the balance may become negative. A refund
reversal restores the purchase and grants without duplication. Partial refunds
use Apple's revocation percentage.

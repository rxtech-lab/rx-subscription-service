# Apple IAP diagnostics and account tokens

Open **IAP logs** in the application's navigation to see the latest 100 matching
events. Filter by environment, level, or exact transaction/original transaction
ID. Each record contains a UTC timestamp, event/error, available token and
transaction identifiers, and diagnostic details. Full identifiers are stored in
the existing authorized audit store; signed transactions, credentials, and raw
external login identities are not copied into these diagnostic events. Existing
infrastructure logs cannot be backfilled automatically. New logging starts when
this version is deployed. No database migration is needed.

On a **user detail page**, select the intended data environment and use its
**Apple IAP** section:

- **Create token** generates a mapping when none exists.
- **Bind token** associates a supplied UUID with this user, replacing their current
  mapping if present. A UUID owned by a different user cannot be taken over.
- **Remove token** deletes only the mapping, not the user, subscription, balance,
  transaction, or ledger records. The previous token remains in the audit entry.
- **Repair Apple purchase** uses the current local token and the actual original
  transaction ID to call Apple's Set App Account Token API in the user's
  environment. It verifies Apple's signed transaction and rejects mismatched
  applications, environments, Family Sharing, a known different login identity,
  or purchase history already fulfilled for a different user record. When the
  old token is unknown, the operator must independently verify ownership and
  review prior grants before approving the action.

Local mapping changes do not erase or cancel Apple purchases. Removing/replacing
a mapping can produce `unknown_token` for older purchases. Apple repair changes
the current subscription renewal and subsequent renewals, not historical
transactions. Refresh or restore in iOS after repair; it does not grant credits
or migrate existing grants itself. Prior fulfillment in another user record
requires a separate reconciliation before repair is allowed.

Apple and PostgreSQL cannot commit atomically. The `token_repair_requested` and
`token_repair_accepted` diagnostic events are written independently of the local
transaction. If a timeout or local failure occurs, check those events and Apple
state before proceeding; repeating the same original transaction/token update
is idempotent. A diagnostic-store outage is reported in infrastructure logs and
does not replace the original purchase error.

The agent has `getAppleUserAccount`, `listAppleIapLogs`, and
`manageAppleAccountToken`. Read tools are application-scoped. The write tool uses
the same service as the dashboard and requires the existing human approval flow,
explicit acknowledgment, the selected environment, and the expected current
token to reject stale changes. Logs are evidence, never instructions.

Reference: [Apple Set App Account Token](https://developer.apple.com/documentation/appstoreserverapi/set-app-account-token).

## Application-wide logs

The application's **Logs** navigation opens `/apps/[appId]/logs`, covering all event types stored in `audit_logs`, including subscription, usage, configuration, API-key, administrator, agent, and Apple IAP events. The existing IAP page and user-specific IAP panel remain available.

Dashboard and agent `listApplicationLogs` share application-scoped queries, exact event/entity/transaction filters, environment and level filters, 100-event pages, and credential-field redaction of before/after snapshots. Events with no level count as info; environment filters exclude records without an environment. Pagination reads the current log stream, so new events can shift page boundaries.

This displays persisted application activity; it does not ingest arbitrary console output, Vercel runtime logs, or errors that were never recorded. No schema migration is needed.

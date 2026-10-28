# Subscription MCP contract

`/api/mcp` supports stateless Streamable HTTP JSON responses (MCP 2025-11-25), authenticated with an opaque OAuth bearer token. GET/SSE and DELETE sessions return 405. Discovery is at `/.well-known/oauth-protected-resource/api/mcp` and `/.well-known/oauth-authorization-server`.

Public clients register at `/api/mcp/oauth/register`, request authorization at `/oauth/authorize`, exchange codes or rotating refresh tokens at `/api/mcp/oauth/token`, and revoke at `/api/mcp/oauth/revoke`. Authorization requires S256 PKCE, an exact registered redirect URI, explicit consent, and the canonical resource URL. Codes live for 60 seconds, access tokens for one hour, and grants/refresh tokens for 30 days. Replaying a code or refresh token revokes the entire connection. Secrets are stored hashed; the delegated RxLab access token is encrypted with AUTH_SECRET and never returned to clients.

Scopes: projects:read, subscriptions:read, subscriptions:write, paywalls:read, paywalls:write. Read-only access is the default. Consent and Settings let the user choose an explicit project allow-list (empty means no projects). Shared paywall scopes cover console-wide templates, as in the dashboard. Subscription tools take `applicationId` and `input`; write tools additionally require `confirmed: true` after the client obtains user approval. Web-only display and confirmation tools are excluded. Project and shared paywall tools are also exposed.

Every tool execution rechecks the delegated user's current RxLab permissions. The allowed project set is intersected with the grant; failed or expired RxLab credentials fail closed and require reconnecting. MCP refresh tokens do not refresh the upstream RxLab login. Scope changes and disconnect take effect on subsequent requests, including existing access tokens. Settings mutations use the authenticated console session and enforce grant ownership.

Set NEXT_PUBLIC_SITE_URL to the public HTTPS origin (HTTP loopback is permitted for development) and a stable AUTH_SECRET before enabling MCP. Run the generated database migration before use. No migration is applied automatically by this feature.

## Local verification

Run `bun run test lib/mcp/oauth.test.ts` for real in-memory PostgreSQL migrations and OAuth tests (no production database). To include upstream HTTP permission checks:

1. `postman simulation run postman/simulations/mcp.sim.yaml --port 4917 --output ndjson`
2. `MCP_SIMULATION_URL=http://127.0.0.1:4917 bun run test lib/mcp/oauth.test.ts`

The local RxLab mock is derived from `lib/rxlab/oauth-clients.ts`. Searching for the owner's published mock was unavailable because Postman was signed out. The mock covers the paginated admin-client response and permission denial only; it does not validate real RxLab sign-in. Tests cover token binding/replay/revocation, scope edits, ownership, project isolation, subscription writes, paywall draft creation/update and fail-closed permission checks.

Use `bun run db:migrate` against the intended deployment database before connecting clients. Migration `0006_loving_masked_marvel.sql` creates the three MCP tables. Keep AUTH_SECRET stable: rotating it requires clients to reconnect because delegated credentials can no longer be decrypted.

Protocol reference: [MCP authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization). Writes retain the web agent's service validation, audit logging and automatic test scheduling. MCP clients are responsible for showing per-action approval before sending `confirmed: true`; OAuth write scopes authorize the client to perform those writes.

## Grant complimentary plan access

Use `listSubscriptionUsers` with an explicit `sandbox` or `production` environment to find the user's environment-specific `appUserId`. Check `listPlans` and `listSubscriptions` before granting. With `subscriptions:write`, call `grantComplimentarySubscription` after approval:

```json
{
  "applicationId": "your-application-id",
  "confirmed": true,
  "input": {
    "appUserId": "environment-specific-user-id",
    "environment": "sandbox",
    "planId": "active-plan-id",
    "periodDays": 30,
    "reason": "Complimentary access approved by support"
  }
}
```

The grant applies plan access and configured allowances without charging or creating a store purchase. It expires after 1–3650 days by default. Set `autoRenew: true` to renew every `periodDays` without charging until canceled. Each renewal grants the plan’s current allowances; missed periods are caught up without duplicate credits. Cancel at period end stops renewal; cancel now ends access immediately. The service rejects environment mismatches, inactive or automatic free plans, and existing ownership in the same plan group. The reason and administrator are recorded in audit history. Xcode is not supported for complimentary grants.

The dashboard provides the same operation under **Subscriptions → Grant subscription** and the user's **Subscriptions → Grant subscription** dialog. Select the environment first, then the user, plan, period length, renewal mode, and reason.

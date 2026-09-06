# Neon data migration — 2026-09-05

The existing Turso database was copied into the Neon database configured by
`DATABASE_URL`. All 46 tables and 943 rows were imported in one transaction.
Per-table row counts and SHA-256 hashes of normalized content matched before
commit. A fresh source export after import showed no changes.

Four `subscriptions.trial_watch_ends_at` values contained the literal column
name instead of a timestamp. With user approval, these were converted to NULL.
Original values remain in the private, git-ignored `.neon-transfer/source.json`
backup, alongside the verification report. Keep these files private; they
contain application data. The source database itself was not modified.

PostgreSQL now enforces foreign keys for future writes. These 21 constraints
could not validate historical orphaned references and remain NOT VALID:

- `applications`: `applications_paywall_id_paywalls_id_fk`
- `store_account_links`: `store_account_links_app_user_id_app_users_id_fk`
- `store_product_mappings`: `store_product_mappings_plan_id_plans_id_fk`
- `store_transactions`: `store_transactions_app_user_id_app_users_id_fk`
- `store_transactions`: `store_transactions_subscription_id_subscriptions_id_fk`
- `plan_entitlements`: `plan_entitlements_plan_id_plans_id_fk`
- `usage_counters`: `usage_counters_app_user_id_app_users_id_fk`
- `usage_counters`: `usage_counters_usage_item_id_usage_items_id_fk`
- `usage_records`: `usage_records_app_user_id_app_users_id_fk`
- `usage_records`: `usage_records_usage_item_id_usage_items_id_fk`
- `balances`: `balances_app_user_id_app_users_id_fk`
- `ledger_entries`: `ledger_entries_app_user_id_app_users_id_fk`
- `coupon_redemptions`: `coupon_redemptions_plan_id_plans_id_fk`
- `coupon_users`: `coupon_users_coupon_id_coupons_id_fk`
- `purchases`: `purchases_app_user_id_app_users_id_fk`
- `stripe_customers`: `stripe_customers_app_user_id_app_users_id_fk`
- `subscriptions`: `subscriptions_app_user_id_app_users_id_fk`
- `subscriptions`: `subscriptions_plan_id_plans_id_fk`
- `balance_lots`: `balance_lots_app_user_id_app_users_id_fk`
- `balance_lots`: `balance_lots_subscription_id_subscriptions_id_fk`
- `balance_lots`: `balance_lots_plan_id_plans_id_fk`

Repair historical references before running `ALTER TABLE ... VALIDATE CONSTRAINT`.
No records were deleted to make constraints pass.

The application and Drizzle Kit now use only `DATABASE_URL`. Local Turso
credentials and the libSQL dependency were removed. The build does not run
schema changes; apply committed SQL with `bun run db:migrate` before deploying.
Hosted environment variables and the deployed application were not changed by
this migration. Before production cutover, pause old-database writers and check
for changes since this snapshot; reconcile any new data before enabling Neon
writers. Do not allow both deployments to accept writes independently.

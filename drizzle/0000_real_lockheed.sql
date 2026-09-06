CREATE TABLE "application_api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"application_id" text NOT NULL,
	"name" text NOT NULL,
	"environment" text DEFAULT 'production' NOT NULL,
	"kind" text DEFAULT 'secret' NOT NULL,
	"allowed_client_ids" text,
	"key_prefix" text NOT NULL,
	"hashed_key" text NOT NULL,
	"last_used_at" timestamp (3) with time zone,
	"revoked_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "application_api_keys_hashed_key_unique" UNIQUE("hashed_key")
);
--> statement-breakpoint
CREATE TABLE "applications" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"icon_url" text,
	"status" text DEFAULT 'active' NOT NULL,
	"default_currency" text DEFAULT 'usd' NOT NULL,
	"run_tests_on_change" boolean DEFAULT false NOT NULL,
	"paywall_id" text,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	"synced_at" timestamp (3) with time zone
);
--> statement-breakpoint
CREATE TABLE "balance_units" (
	"id" text PRIMARY KEY NOT NULL,
	"application_id" text NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"symbol" text,
	"precision" bigint DEFAULT 0 NOT NULL,
	"kind" text DEFAULT 'points' NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "balance_units_precision_range" CHECK ("balance_units"."precision" >= 0 AND "balance_units"."precision" <= 9)
);
--> statement-breakpoint
CREATE TABLE "point_rates" (
	"id" text PRIMARY KEY NOT NULL,
	"application_id" text NOT NULL,
	"unit_id" text NOT NULL,
	"currency" text NOT NULL,
	"nano_minor_per_unit" bigint NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "point_rates_positive" CHECK ("point_rates"."nano_minor_per_unit" > 0)
);
--> statement-breakpoint
CREATE TABLE "app_user_roles" (
	"id" text PRIMARY KEY NOT NULL,
	"app_user_id" text NOT NULL,
	"role_id" text NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"id" text PRIMARY KEY NOT NULL,
	"application_id" text NOT NULL,
	"key" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"supports_all" boolean DEFAULT true NOT NULL,
	"supports_ids" boolean DEFAULT true NOT NULL,
	"sort_order" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"id" text PRIMARY KEY NOT NULL,
	"role_id" text NOT NULL,
	"permission_id" text NOT NULL,
	"scope" text NOT NULL,
	"target_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscription_roles" (
	"id" text PRIMARY KEY NOT NULL,
	"application_id" text NOT NULL,
	"key" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"sort_order" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "apple_store_integrations" (
	"id" text PRIMARY KEY NOT NULL,
	"application_id" text NOT NULL,
	"bundle_id" text NOT NULL,
	"app_apple_id" bigint NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "apple_store_integrations_application_id_unique" UNIQUE("application_id"),
	CONSTRAINT "apple_store_integrations_bundle_id_unique" UNIQUE("bundle_id"),
	CONSTRAINT "apple_store_integrations_app_apple_id_unique" UNIQUE("app_apple_id"),
	CONSTRAINT "apple_store_app_id_positive" CHECK ("apple_store_integrations"."app_apple_id" > 0)
);
--> statement-breakpoint
CREATE TABLE "store_account_links" (
	"id" text PRIMARY KEY NOT NULL,
	"application_id" text NOT NULL,
	"app_user_id" text NOT NULL,
	"provider" text NOT NULL,
	"provider_account_token" text NOT NULL,
	"consumption_data_consent" boolean DEFAULT false NOT NULL,
	"consent_updated_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_product_mappings" (
	"id" text PRIMARY KEY NOT NULL,
	"application_id" text NOT NULL,
	"provider" text NOT NULL,
	"product_id" text NOT NULL,
	"product_type" text NOT NULL,
	"plan_id" text,
	"topup_product_id" text,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "store_products_exactly_one_target" CHECK (("store_product_mappings"."plan_id" IS NOT NULL AND "store_product_mappings"."topup_product_id" IS NULL) OR ("store_product_mappings"."plan_id" IS NULL AND "store_product_mappings"."topup_product_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "store_product_prices" (
	"id" text PRIMARY KEY NOT NULL,
	"store_product_mapping_id" text NOT NULL,
	"price_amount_cents" bigint NOT NULL,
	"currency" text NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "store_product_prices_store_product_mapping_id_unique" UNIQUE("store_product_mapping_id")
);
--> statement-breakpoint
CREATE TABLE "store_provider_events" (
	"id" text PRIMARY KEY NOT NULL,
	"application_id" text NOT NULL,
	"provider" text NOT NULL,
	"environment" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"type" text NOT NULL,
	"subtype" text,
	"status" text NOT NULL,
	"signed_at" timestamp (3) with time zone,
	"signed_payload" text NOT NULL,
	"failure_code" text,
	"created_at" timestamp (3) with time zone NOT NULL,
	"processed_at" timestamp (3) with time zone
);
--> statement-breakpoint
CREATE TABLE "store_reconciliation_cursors" (
	"id" text PRIMARY KEY NOT NULL,
	"application_id" text NOT NULL,
	"provider" text NOT NULL,
	"environment" text NOT NULL,
	"last_synced_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"application_id" text NOT NULL,
	"app_user_id" text NOT NULL,
	"provider" text NOT NULL,
	"environment" text NOT NULL,
	"transaction_id" text NOT NULL,
	"original_transaction_id" text NOT NULL,
	"product_id" text NOT NULL,
	"product_type" text NOT NULL,
	"quantity" bigint DEFAULT 1 NOT NULL,
	"price_milliunits" bigint,
	"currency" text,
	"purchase_at" timestamp (3) with time zone NOT NULL,
	"expires_at" timestamp (3) with time zone,
	"revoked_at" timestamp (3) with time zone,
	"revocation_percentage" bigint DEFAULT 0 NOT NULL,
	"signed_at" timestamp (3) with time zone NOT NULL,
	"signed_transaction" text NOT NULL,
	"subscription_id" text,
	"purchase_id" text,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "store_transactions_quantity_positive" CHECK ("store_transactions"."quantity" >= 1),
	CONSTRAINT "store_transactions_revocation_percentage" CHECK ("store_transactions"."revocation_percentage" >= 0 AND "store_transactions"."revocation_percentage" <= 100000)
);
--> statement-breakpoint
CREATE TABLE "plan_entitlements" (
	"id" text PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"kind" text NOT NULL,
	"role_id" text,
	"permission_key" text,
	"permission_scope" text,
	"permission_target_ids" jsonb,
	"usage_item_id" text,
	"limit_value" bigint,
	"trial_limit_value" bigint,
	"unit_id" text,
	"amount" bigint,
	"trial_amount" bigint,
	"balance_expiry_policy" text DEFAULT 'never' NOT NULL,
	"balance_expiry_months" bigint,
	"feature_key" text,
	"feature_value" text,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "plan_entitlements_expiry_months_positive" CHECK ("plan_entitlements"."balance_expiry_months" IS NULL OR "plan_entitlements"."balance_expiry_months" >= 1),
	CONSTRAINT "plan_entitlements_expiry_months_required" CHECK ("plan_entitlements"."balance_expiry_policy" NOT IN ('duration', 'after_plan_end') OR "plan_entitlements"."balance_expiry_months" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" text PRIMARY KEY NOT NULL,
	"application_id" text NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"plan_group" text DEFAULT 'default' NOT NULL,
	"billing_interval" text NOT NULL,
	"interval_count" bigint DEFAULT 1 NOT NULL,
	"price_amount_cents" bigint NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"trial_days" bigint DEFAULT 0 NOT NULL,
	"auto_subscribe" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"sort_order" bigint DEFAULT 0 NOT NULL,
	"stripe_product_id" text,
	"stripe_price_id" text,
	"stripe_sandbox_product_id" text,
	"stripe_sandbox_price_id" text,
	"metadata" jsonb,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "plans_price_nonnegative" CHECK ("plans"."price_amount_cents" >= 0),
	CONSTRAINT "plans_interval_count_positive" CHECK ("plans"."interval_count" >= 1),
	CONSTRAINT "plans_trial_nonnegative" CHECK ("plans"."trial_days" >= 0)
);
--> statement-breakpoint
CREATE TABLE "app_user_usage_limits" (
	"id" text PRIMARY KEY NOT NULL,
	"app_user_id" text NOT NULL,
	"usage_item_id" text NOT NULL,
	"limit_value" bigint,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "app_user_usage_limits_nonnegative" CHECK ("app_user_usage_limits"."limit_value" IS NULL OR "app_user_usage_limits"."limit_value" >= 0)
);
--> statement-breakpoint
CREATE TABLE "usage_counters" (
	"id" text PRIMARY KEY NOT NULL,
	"app_user_id" text NOT NULL,
	"usage_item_id" text NOT NULL,
	"period_start" timestamp (3) with time zone NOT NULL,
	"period_end" timestamp (3) with time zone,
	"used" bigint DEFAULT 0 NOT NULL,
	"limit_value" bigint,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "usage_counters_used_nonnegative" CHECK ("usage_counters"."used" >= 0)
);
--> statement-breakpoint
CREATE TABLE "usage_items" (
	"id" text PRIMARY KEY NOT NULL,
	"application_id" text NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"value_type" text DEFAULT 'counter' NOT NULL,
	"reset_policy" text DEFAULT 'never' NOT NULL,
	"reset_interval_count" bigint,
	"reset_interval_unit" text,
	"default_limit" bigint,
	"overage_policy" text DEFAULT 'block' NOT NULL,
	"overage_unit_id" text,
	"overage_cost_per_unit" bigint,
	"sort_order" bigint DEFAULT 0 NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "usage_items_interval_positive" CHECK ("usage_items"."reset_interval_count" IS NULL OR "usage_items"."reset_interval_count" >= 1),
	CONSTRAINT "usage_items_limit_nonnegative" CHECK ("usage_items"."default_limit" IS NULL OR "usage_items"."default_limit" >= 0)
);
--> statement-breakpoint
CREATE TABLE "usage_records" (
	"id" text PRIMARY KEY NOT NULL,
	"app_user_id" text NOT NULL,
	"usage_item_id" text NOT NULL,
	"counter_id" text,
	"amount" bigint NOT NULL,
	"used_after" bigint NOT NULL,
	"charged_units" bigint DEFAULT 0 NOT NULL,
	"idempotency_key" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "usage_records_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "app_users" (
	"id" text PRIMARY KEY NOT NULL,
	"application_id" text NOT NULL,
	"rxlab_user_id" text NOT NULL,
	"environment" text DEFAULT 'production' NOT NULL,
	"email" text,
	"display_name" text,
	"level" bigint DEFAULT 0 NOT NULL,
	"level_key" text,
	"external_ref" text,
	"is_test" boolean DEFAULT false NOT NULL,
	"test_note" text,
	"test_clock_offset_ms" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "balance_reservation_operations" (
	"id" text PRIMARY KEY NOT NULL,
	"application_id" text NOT NULL,
	"reservation_id" text NOT NULL,
	"kind" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"response" jsonb NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "balance_reservation_operations_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "balance_reservations" (
	"id" text PRIMARY KEY NOT NULL,
	"application_id" text NOT NULL,
	"app_user_id" text NOT NULL,
	"unit_id" text NOT NULL,
	"initial_amount" bigint NOT NULL,
	"amount" bigint NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"description" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"metadata" jsonb,
	"available_after_reserve" bigint NOT NULL,
	"ttl_seconds" bigint NOT NULL,
	"expires_at" timestamp (3) with time zone NOT NULL,
	"requested_amount" bigint DEFAULT 0 NOT NULL,
	"settled_amount" bigint DEFAULT 0 NOT NULL,
	"released_amount" bigint DEFAULT 0 NOT NULL,
	"shortfall_amount" bigint DEFAULT 0 NOT NULL,
	"release_reason" text,
	"entry_id" text,
	"balance_after" bigint,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	"closed_at" timestamp (3) with time zone,
	CONSTRAINT "balance_reservations_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "balance_reservations_initial_positive" CHECK ("balance_reservations"."initial_amount" > 0),
	CONSTRAINT "balance_reservations_amount_nonnegative" CHECK ("balance_reservations"."amount" >= 0),
	CONSTRAINT "balance_reservations_available_nonnegative" CHECK ("balance_reservations"."available_after_reserve" >= 0),
	CONSTRAINT "balance_reservations_requested_nonnegative" CHECK ("balance_reservations"."requested_amount" >= 0),
	CONSTRAINT "balance_reservations_settled_nonnegative" CHECK ("balance_reservations"."settled_amount" >= 0),
	CONSTRAINT "balance_reservations_released_nonnegative" CHECK ("balance_reservations"."released_amount" >= 0),
	CONSTRAINT "balance_reservations_shortfall_nonnegative" CHECK ("balance_reservations"."shortfall_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "balances" (
	"id" text PRIMARY KEY NOT NULL,
	"app_user_id" text NOT NULL,
	"unit_id" text NOT NULL,
	"amount" bigint DEFAULT 0 NOT NULL,
	"reserved" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "balances_reserved_nonnegative" CHECK ("balances"."reserved" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"app_user_id" text NOT NULL,
	"unit_id" text NOT NULL,
	"kind" text NOT NULL,
	"delta" bigint NOT NULL,
	"balance_after" bigint NOT NULL,
	"description" text NOT NULL,
	"reference_type" text,
	"reference_id" text,
	"idempotency_key" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "ledger_entries_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "topup_eligibility_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"topup_product_id" text NOT NULL,
	"rule_type" text NOT NULL,
	"plan_id" text,
	"role_id" text,
	"created_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "topup_products" (
	"id" text PRIMARY KEY NOT NULL,
	"application_id" text NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"unit_id" text NOT NULL,
	"amount" bigint NOT NULL,
	"price_amount_cents" bigint NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"max_purchases_per_user" bigint,
	"sort_order" bigint DEFAULT 0 NOT NULL,
	"stripe_product_id" text,
	"stripe_price_id" text,
	"stripe_sandbox_product_id" text,
	"stripe_sandbox_price_id" text,
	"metadata" jsonb,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "topup_products_amount_positive" CHECK ("topup_products"."amount" > 0),
	CONSTRAINT "topup_products_price_nonnegative" CHECK ("topup_products"."price_amount_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "coupon_redemptions" (
	"id" text PRIMARY KEY NOT NULL,
	"coupon_id" text NOT NULL,
	"application_id" text NOT NULL,
	"app_user_id" text NOT NULL,
	"status" text DEFAULT 'reserved' NOT NULL,
	"plan_id" text,
	"topup_product_id" text,
	"purchase_id" text,
	"discount_cents" bigint DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"stripe_coupon_id" text,
	"stripe_checkout_session_id" text,
	"created_at" timestamp (3) with time zone NOT NULL,
	"redeemed_at" timestamp (3) with time zone,
	CONSTRAINT "coupon_redemptions_at_most_one_target" CHECK ("coupon_redemptions"."plan_id" is null or "coupon_redemptions"."topup_product_id" is null)
);
--> statement-breakpoint
CREATE TABLE "coupon_targets" (
	"id" text PRIMARY KEY NOT NULL,
	"coupon_id" text NOT NULL,
	"plan_id" text,
	"topup_product_id" text,
	"created_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "coupon_targets_exactly_one_target" CHECK (("coupon_targets"."plan_id" is not null and "coupon_targets"."topup_product_id" is null) or ("coupon_targets"."plan_id" is null and "coupon_targets"."topup_product_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "coupon_users" (
	"id" text PRIMARY KEY NOT NULL,
	"coupon_id" text NOT NULL,
	"app_user_id" text NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coupons" (
	"id" text PRIMARY KEY NOT NULL,
	"application_id" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"discount_type" text NOT NULL,
	"percent_basis_points" bigint,
	"amount_off_cents" bigint,
	"currency" text DEFAULT 'usd' NOT NULL,
	"max_discount_cents" bigint,
	"duration" text DEFAULT 'once' NOT NULL,
	"duration_in_months" bigint,
	"applies_to" text DEFAULT 'all' NOT NULL,
	"restrict_to_users" boolean DEFAULT false NOT NULL,
	"max_redemptions" bigint,
	"max_redemptions_per_user" bigint,
	"minimum_amount_cents" bigint,
	"first_time_only" boolean DEFAULT false NOT NULL,
	"starts_at" timestamp (3) with time zone,
	"redeem_by" timestamp (3) with time zone,
	"status" text DEFAULT 'draft' NOT NULL,
	"stripe_coupon_id" text,
	"stripe_sandbox_coupon_id" text,
	"metadata" jsonb,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "coupons_percent_range" CHECK ("coupons"."percent_basis_points" is null or ("coupons"."percent_basis_points" > 0 and "coupons"."percent_basis_points" <= 10000)),
	CONSTRAINT "coupons_amount_positive" CHECK ("coupons"."amount_off_cents" is null or "coupons"."amount_off_cents" > 0),
	CONSTRAINT "coupons_max_discount_positive" CHECK ("coupons"."max_discount_cents" is null or "coupons"."max_discount_cents" > 0),
	CONSTRAINT "coupons_duration_months" CHECK ("coupons"."duration" <> 'repeating' or "coupons"."duration_in_months" >= 1),
	CONSTRAINT "coupons_discount_shape" CHECK (("coupons"."discount_type" = 'percent' and "coupons"."percent_basis_points" is not null and "coupons"."amount_off_cents" is null) or ("coupons"."discount_type" = 'amount' and "coupons"."amount_off_cents" is not null and "coupons"."percent_basis_points" is null)),
	CONSTRAINT "coupons_usage_limits" CHECK (("coupons"."max_redemptions" is null or "coupons"."max_redemptions" > 0) and ("coupons"."max_redemptions_per_user" is null or "coupons"."max_redemptions_per_user" > 0) and ("coupons"."minimum_amount_cents" is null or "coupons"."minimum_amount_cents" >= 0)),
	CONSTRAINT "coupons_redemption_window" CHECK ("coupons"."starts_at" is null or "coupons"."redeem_by" is null or "coupons"."starts_at" < "coupons"."redeem_by")
);
--> statement-breakpoint
CREATE TABLE "purchases" (
	"id" text PRIMARY KEY NOT NULL,
	"application_id" text NOT NULL,
	"app_user_id" text NOT NULL,
	"kind" text NOT NULL,
	"plan_id" text,
	"topup_product_id" text,
	"unit_id" text,
	"units_granted" bigint DEFAULT 0 NOT NULL,
	"amount_cents" bigint NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"status" text NOT NULL,
	"billing_provider" text DEFAULT 'stripe' NOT NULL,
	"provider_transaction_id" text,
	"provider_original_transaction_id" text,
	"provider_product_id" text,
	"quantity" bigint DEFAULT 1 NOT NULL,
	"price_milliunits" bigint,
	"entitlement_snapshot" jsonb,
	"fulfillment_failure_code" text,
	"stripe_checkout_session_id" text,
	"stripe_payment_intent_id" text,
	"stripe_invoice_id" text,
	"hosted_invoice_url" text,
	"invoice_pdf_url" text,
	"refunded_amount_cents" bigint DEFAULT 0 NOT NULL,
	"reversed_units" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	"paid_at" timestamp (3) with time zone,
	CONSTRAINT "purchases_stripe_checkout_session_id_unique" UNIQUE("stripe_checkout_session_id"),
	CONSTRAINT "purchases_stripe_payment_intent_id_unique" UNIQUE("stripe_payment_intent_id"),
	CONSTRAINT "purchases_quantity_positive" CHECK ("purchases"."quantity" >= 1),
	CONSTRAINT "purchases_refund_nonnegative" CHECK ("purchases"."refunded_amount_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "stripe_customers" (
	"id" text PRIMARY KEY NOT NULL,
	"app_user_id" text NOT NULL,
	"stripe_customer_id" text NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "stripe_customers_app_user_id_unique" UNIQUE("app_user_id"),
	CONSTRAINT "stripe_customers_stripe_customer_id_unique" UNIQUE("stripe_customer_id")
);
--> statement-breakpoint
CREATE TABLE "stripe_webhook_events" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"status" text NOT NULL,
	"object_id" text,
	"failure_code" text,
	"created_at" timestamp (3) with time zone NOT NULL,
	"processed_at" timestamp (3) with time zone
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"application_id" text NOT NULL,
	"app_user_id" text NOT NULL,
	"plan_id" text NOT NULL,
	"status" text NOT NULL,
	"current_period_start" timestamp (3) with time zone,
	"current_period_end" timestamp (3) with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"billing_provider" text DEFAULT 'stripe' NOT NULL,
	"provider_subscription_id" text,
	"provider_product_id" text,
	"provider_signed_at" timestamp (3) with time zone,
	"stripe_subscription_id" text,
	"stripe_customer_id" text,
	"entitlement_snapshot" jsonb,
	"trial_watch_run_id" text,
	"trial_watch_ends_at" timestamp (3) with time zone,
	"started_at" timestamp (3) with time zone NOT NULL,
	"ended_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "subscriptions_stripe_subscription_id_unique" UNIQUE("stripe_subscription_id")
);
--> statement-breakpoint
CREATE TABLE "balance_lots" (
	"id" text PRIMARY KEY NOT NULL,
	"app_user_id" text NOT NULL,
	"unit_id" text NOT NULL,
	"ledger_entry_id" text,
	"original_amount" bigint NOT NULL,
	"remaining" bigint NOT NULL,
	"expires_at" timestamp (3) with time zone,
	"expiry_policy" text DEFAULT 'never' NOT NULL,
	"expiry_months" bigint,
	"subscription_id" text,
	"plan_id" text,
	"expired_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "balance_lots_remaining_nonnegative" CHECK ("balance_lots"."remaining" >= 0),
	CONSTRAINT "balance_lots_remaining_within_original" CHECK ("balance_lots"."remaining" <= "balance_lots"."original_amount")
);
--> statement-breakpoint
CREATE TABLE "ai_conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"application_id" text,
	"rxlab_user_id" text NOT NULL,
	"title" text,
	"summary" text,
	"summary_message_count" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"role" text NOT NULL,
	"parts" jsonb NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"application_id" text,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"before" jsonb,
	"after" jsonb,
	"conversation_id" text,
	"created_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "test_run_cases" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"suite_name" text NOT NULL,
	"name" text NOT NULL,
	"status" text NOT NULL,
	"position" bigint NOT NULL,
	"duration_ms" bigint,
	"error" text,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"started_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "test_run_events" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"seq" bigint NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "test_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"application_id" text NOT NULL,
	"suite_id" text NOT NULL,
	"code" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"trigger" text DEFAULT 'console' NOT NULL,
	"triggered_by" text,
	"conversation_id" text,
	"driver" text DEFAULT 'sandbox' NOT NULL,
	"total" bigint DEFAULT 0 NOT NULL,
	"passed" bigint DEFAULT 0 NOT NULL,
	"failed" bigint DEFAULT 0 NOT NULL,
	"skipped" bigint DEFAULT 0 NOT NULL,
	"duration_ms" bigint,
	"error" text,
	"started_at" timestamp (3) with time zone NOT NULL,
	"finished_at" timestamp (3) with time zone
);
--> statement-breakpoint
CREATE TABLE "test_suites" (
	"id" text PRIMARY KEY NOT NULL,
	"application_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"code" text NOT NULL,
	"updated_by" text DEFAULT 'user' NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "paywall_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"paywall_id" text NOT NULL,
	"version" bigint NOT NULL,
	"spec" jsonb NOT NULL,
	"source" text NOT NULL,
	"restored_from_version" bigint,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"created_at" timestamp (3) with time zone NOT NULL,
	"published_at" timestamp (3) with time zone
);
--> statement-breakpoint
CREATE TABLE "paywalls" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"draft_spec" jsonb NOT NULL,
	"published_spec" jsonb,
	"updated_by" text DEFAULT 'user' NOT NULL,
	"created_by" text,
	"published_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "application_api_keys" ADD CONSTRAINT "application_api_keys_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_paywall_id_paywalls_id_fk" FOREIGN KEY ("paywall_id") REFERENCES "public"."paywalls"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "balance_units" ADD CONSTRAINT "balance_units_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "point_rates" ADD CONSTRAINT "point_rates_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "point_rates" ADD CONSTRAINT "point_rates_unit_id_balance_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."balance_units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_user_roles" ADD CONSTRAINT "app_user_roles_app_user_id_app_users_id_fk" FOREIGN KEY ("app_user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_user_roles" ADD CONSTRAINT "app_user_roles_role_id_subscription_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."subscription_roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permissions" ADD CONSTRAINT "permissions_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_subscription_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."subscription_roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_roles" ADD CONSTRAINT "subscription_roles_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apple_store_integrations" ADD CONSTRAINT "apple_store_integrations_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_account_links" ADD CONSTRAINT "store_account_links_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_account_links" ADD CONSTRAINT "store_account_links_app_user_id_app_users_id_fk" FOREIGN KEY ("app_user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_product_mappings" ADD CONSTRAINT "store_product_mappings_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_product_mappings" ADD CONSTRAINT "store_product_mappings_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_product_mappings" ADD CONSTRAINT "store_product_mappings_topup_product_id_topup_products_id_fk" FOREIGN KEY ("topup_product_id") REFERENCES "public"."topup_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_product_prices" ADD CONSTRAINT "store_product_prices_store_product_mapping_id_store_product_mappings_id_fk" FOREIGN KEY ("store_product_mapping_id") REFERENCES "public"."store_product_mappings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_provider_events" ADD CONSTRAINT "store_provider_events_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_reconciliation_cursors" ADD CONSTRAINT "store_reconciliation_cursors_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_transactions" ADD CONSTRAINT "store_transactions_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_transactions" ADD CONSTRAINT "store_transactions_app_user_id_app_users_id_fk" FOREIGN KEY ("app_user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_transactions" ADD CONSTRAINT "store_transactions_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_transactions" ADD CONSTRAINT "store_transactions_purchase_id_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_entitlements" ADD CONSTRAINT "plan_entitlements_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_entitlements" ADD CONSTRAINT "plan_entitlements_role_id_subscription_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."subscription_roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_entitlements" ADD CONSTRAINT "plan_entitlements_usage_item_id_usage_items_id_fk" FOREIGN KEY ("usage_item_id") REFERENCES "public"."usage_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_entitlements" ADD CONSTRAINT "plan_entitlements_unit_id_balance_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."balance_units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_user_usage_limits" ADD CONSTRAINT "app_user_usage_limits_app_user_id_app_users_id_fk" FOREIGN KEY ("app_user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_user_usage_limits" ADD CONSTRAINT "app_user_usage_limits_usage_item_id_usage_items_id_fk" FOREIGN KEY ("usage_item_id") REFERENCES "public"."usage_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_counters" ADD CONSTRAINT "usage_counters_app_user_id_app_users_id_fk" FOREIGN KEY ("app_user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_counters" ADD CONSTRAINT "usage_counters_usage_item_id_usage_items_id_fk" FOREIGN KEY ("usage_item_id") REFERENCES "public"."usage_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_items" ADD CONSTRAINT "usage_items_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_items" ADD CONSTRAINT "usage_items_overage_unit_id_balance_units_id_fk" FOREIGN KEY ("overage_unit_id") REFERENCES "public"."balance_units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_app_user_id_app_users_id_fk" FOREIGN KEY ("app_user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_usage_item_id_usage_items_id_fk" FOREIGN KEY ("usage_item_id") REFERENCES "public"."usage_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_counter_id_usage_counters_id_fk" FOREIGN KEY ("counter_id") REFERENCES "public"."usage_counters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_users" ADD CONSTRAINT "app_users_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "balance_reservation_operations" ADD CONSTRAINT "balance_reservation_operations_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "balance_reservation_operations" ADD CONSTRAINT "balance_reservation_operations_reservation_id_balance_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."balance_reservations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "balance_reservations" ADD CONSTRAINT "balance_reservations_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "balance_reservations" ADD CONSTRAINT "balance_reservations_app_user_id_app_users_id_fk" FOREIGN KEY ("app_user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "balance_reservations" ADD CONSTRAINT "balance_reservations_unit_id_balance_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."balance_units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "balances" ADD CONSTRAINT "balances_app_user_id_app_users_id_fk" FOREIGN KEY ("app_user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "balances" ADD CONSTRAINT "balances_unit_id_balance_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."balance_units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_app_user_id_app_users_id_fk" FOREIGN KEY ("app_user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_unit_id_balance_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."balance_units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topup_eligibility_rules" ADD CONSTRAINT "topup_eligibility_rules_topup_product_id_topup_products_id_fk" FOREIGN KEY ("topup_product_id") REFERENCES "public"."topup_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topup_eligibility_rules" ADD CONSTRAINT "topup_eligibility_rules_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topup_eligibility_rules" ADD CONSTRAINT "topup_eligibility_rules_role_id_subscription_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."subscription_roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topup_products" ADD CONSTRAINT "topup_products_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topup_products" ADD CONSTRAINT "topup_products_unit_id_balance_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."balance_units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_app_user_id_app_users_id_fk" FOREIGN KEY ("app_user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_topup_product_id_topup_products_id_fk" FOREIGN KEY ("topup_product_id") REFERENCES "public"."topup_products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_targets" ADD CONSTRAINT "coupon_targets_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_targets" ADD CONSTRAINT "coupon_targets_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_targets" ADD CONSTRAINT "coupon_targets_topup_product_id_topup_products_id_fk" FOREIGN KEY ("topup_product_id") REFERENCES "public"."topup_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_users" ADD CONSTRAINT "coupon_users_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_users" ADD CONSTRAINT "coupon_users_app_user_id_app_users_id_fk" FOREIGN KEY ("app_user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_app_user_id_app_users_id_fk" FOREIGN KEY ("app_user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_topup_product_id_topup_products_id_fk" FOREIGN KEY ("topup_product_id") REFERENCES "public"."topup_products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_unit_id_balance_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."balance_units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stripe_customers" ADD CONSTRAINT "stripe_customers_app_user_id_app_users_id_fk" FOREIGN KEY ("app_user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_app_user_id_app_users_id_fk" FOREIGN KEY ("app_user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "balance_lots" ADD CONSTRAINT "balance_lots_app_user_id_app_users_id_fk" FOREIGN KEY ("app_user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "balance_lots" ADD CONSTRAINT "balance_lots_unit_id_balance_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."balance_units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "balance_lots" ADD CONSTRAINT "balance_lots_ledger_entry_id_ledger_entries_id_fk" FOREIGN KEY ("ledger_entry_id") REFERENCES "public"."ledger_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "balance_lots" ADD CONSTRAINT "balance_lots_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "balance_lots" ADD CONSTRAINT "balance_lots_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_conversation_id_ai_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."ai_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_run_cases" ADD CONSTRAINT "test_run_cases_run_id_test_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."test_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_run_events" ADD CONSTRAINT "test_run_events_run_id_test_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."test_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_runs" ADD CONSTRAINT "test_runs_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_runs" ADD CONSTRAINT "test_runs_suite_id_test_suites_id_fk" FOREIGN KEY ("suite_id") REFERENCES "public"."test_suites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_suites" ADD CONSTRAINT "test_suites_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paywall_versions" ADD CONSTRAINT "paywall_versions_paywall_id_paywalls_id_fk" FOREIGN KEY ("paywall_id") REFERENCES "public"."paywalls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "application_api_keys_app_idx" ON "application_api_keys" USING btree ("application_id");--> statement-breakpoint
CREATE UNIQUE INDEX "application_api_keys_hash_idx" ON "application_api_keys" USING btree ("hashed_key");--> statement-breakpoint
CREATE UNIQUE INDEX "balance_units_app_key_idx" ON "balance_units" USING btree ("application_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "point_rates_unit_currency_idx" ON "point_rates" USING btree ("unit_id","currency");--> statement-breakpoint
CREATE INDEX "point_rates_app_idx" ON "point_rates" USING btree ("application_id");--> statement-breakpoint
CREATE UNIQUE INDEX "app_user_roles_user_role_idx" ON "app_user_roles" USING btree ("app_user_id","role_id");--> statement-breakpoint
CREATE INDEX "app_user_roles_role_idx" ON "app_user_roles" USING btree ("role_id");--> statement-breakpoint
CREATE UNIQUE INDEX "permissions_app_key_idx" ON "permissions" USING btree ("application_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "role_permissions_role_permission_idx" ON "role_permissions" USING btree ("role_id","permission_id");--> statement-breakpoint
CREATE INDEX "role_permissions_permission_idx" ON "role_permissions" USING btree ("permission_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_roles_app_key_idx" ON "subscription_roles" USING btree ("application_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "store_accounts_user_provider_idx" ON "store_account_links" USING btree ("app_user_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "store_accounts_provider_token_idx" ON "store_account_links" USING btree ("provider","provider_account_token");--> statement-breakpoint
CREATE INDEX "store_accounts_app_idx" ON "store_account_links" USING btree ("application_id");--> statement-breakpoint
CREATE UNIQUE INDEX "store_products_app_provider_product_idx" ON "store_product_mappings" USING btree ("application_id","provider","product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "store_products_provider_plan_idx" ON "store_product_mappings" USING btree ("provider","plan_id");--> statement-breakpoint
CREATE UNIQUE INDEX "store_products_provider_topup_idx" ON "store_product_mappings" USING btree ("provider","topup_product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "store_events_provider_event_idx" ON "store_provider_events" USING btree ("provider","provider_event_id");--> statement-breakpoint
CREATE INDEX "store_events_app_status_idx" ON "store_provider_events" USING btree ("application_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "store_reconciliation_app_provider_env_idx" ON "store_reconciliation_cursors" USING btree ("application_id","provider","environment");--> statement-breakpoint
CREATE UNIQUE INDEX "store_transactions_provider_transaction_idx" ON "store_transactions" USING btree ("provider","app_user_id","transaction_id");--> statement-breakpoint
CREATE INDEX "store_transactions_original_idx" ON "store_transactions" USING btree ("provider","app_user_id","original_transaction_id");--> statement-breakpoint
CREATE INDEX "store_transactions_user_idx" ON "store_transactions" USING btree ("app_user_id","purchase_at");--> statement-breakpoint
CREATE INDEX "plan_entitlements_plan_idx" ON "plan_entitlements" USING btree ("plan_id");--> statement-breakpoint
CREATE UNIQUE INDEX "plans_app_key_idx" ON "plans" USING btree ("application_id","key");--> statement-breakpoint
CREATE INDEX "plans_app_status_idx" ON "plans" USING btree ("application_id","status");--> statement-breakpoint
CREATE INDEX "plans_app_group_idx" ON "plans" USING btree ("application_id","plan_group");--> statement-breakpoint
CREATE UNIQUE INDEX "plans_app_group_auto_subscribe_idx" ON "plans" USING btree ("application_id","plan_group") WHERE "plans"."auto_subscribe" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "app_user_usage_limits_user_item_idx" ON "app_user_usage_limits" USING btree ("app_user_id","usage_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "usage_counters_user_item_period_idx" ON "usage_counters" USING btree ("app_user_id","usage_item_id","period_start");--> statement-breakpoint
CREATE INDEX "usage_counters_user_item_idx" ON "usage_counters" USING btree ("app_user_id","usage_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "usage_items_app_key_idx" ON "usage_items" USING btree ("application_id","key");--> statement-breakpoint
CREATE INDEX "usage_records_user_created_idx" ON "usage_records" USING btree ("app_user_id","created_at");--> statement-breakpoint
CREATE INDEX "usage_records_item_created_idx" ON "usage_records" USING btree ("usage_item_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "app_users_app_rxlab_env_idx" ON "app_users" USING btree ("application_id","rxlab_user_id","environment");--> statement-breakpoint
CREATE INDEX "app_users_rxlab_idx" ON "app_users" USING btree ("rxlab_user_id");--> statement-breakpoint
CREATE INDEX "app_users_app_test_idx" ON "app_users" USING btree ("application_id","is_test");--> statement-breakpoint
CREATE INDEX "app_users_app_environment_idx" ON "app_users" USING btree ("application_id","environment");--> statement-breakpoint
CREATE INDEX "balance_reservation_operations_reservation_idx" ON "balance_reservation_operations" USING btree ("reservation_id","created_at");--> statement-breakpoint
CREATE INDEX "balance_reservation_operations_app_idx" ON "balance_reservation_operations" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "balance_reservations_app_user_status_idx" ON "balance_reservations" USING btree ("application_id","app_user_id","status");--> statement-breakpoint
CREATE INDEX "balance_reservations_expiry_idx" ON "balance_reservations" USING btree ("status","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "balances_user_unit_idx" ON "balances" USING btree ("app_user_id","unit_id");--> statement-breakpoint
CREATE INDEX "ledger_entries_user_created_idx" ON "ledger_entries" USING btree ("app_user_id","created_at");--> statement-breakpoint
CREATE INDEX "ledger_entries_reference_idx" ON "ledger_entries" USING btree ("reference_type","reference_id");--> statement-breakpoint
CREATE INDEX "topup_eligibility_rules_product_idx" ON "topup_eligibility_rules" USING btree ("topup_product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "topup_products_app_key_idx" ON "topup_products" USING btree ("application_id","key");--> statement-breakpoint
CREATE INDEX "topup_products_app_status_idx" ON "topup_products" USING btree ("application_id","status");--> statement-breakpoint
CREATE INDEX "coupon_redemptions_coupon_status_idx" ON "coupon_redemptions" USING btree ("coupon_id","status");--> statement-breakpoint
CREATE INDEX "coupon_redemptions_user_idx" ON "coupon_redemptions" USING btree ("coupon_id","app_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "coupon_redemptions_session_idx" ON "coupon_redemptions" USING btree ("stripe_checkout_session_id");--> statement-breakpoint
CREATE INDEX "coupon_targets_coupon_idx" ON "coupon_targets" USING btree ("coupon_id");--> statement-breakpoint
CREATE UNIQUE INDEX "coupon_targets_plan_idx" ON "coupon_targets" USING btree ("coupon_id","plan_id");--> statement-breakpoint
CREATE UNIQUE INDEX "coupon_targets_topup_idx" ON "coupon_targets" USING btree ("coupon_id","topup_product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "coupon_users_coupon_user_idx" ON "coupon_users" USING btree ("coupon_id","app_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "coupons_app_code_idx" ON "coupons" USING btree ("application_id","code");--> statement-breakpoint
CREATE INDEX "coupons_app_status_idx" ON "coupons" USING btree ("application_id","status");--> statement-breakpoint
CREATE INDEX "purchases_user_created_idx" ON "purchases" USING btree ("app_user_id","created_at");--> statement-breakpoint
CREATE INDEX "purchases_app_created_idx" ON "purchases" USING btree ("application_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "purchases_provider_transaction_idx" ON "purchases" USING btree ("billing_provider","app_user_id","provider_transaction_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stripe_customers_customer_idx" ON "stripe_customers" USING btree ("stripe_customer_id");--> statement-breakpoint
CREATE INDEX "subscriptions_user_status_idx" ON "subscriptions" USING btree ("app_user_id","status");--> statement-breakpoint
CREATE INDEX "subscriptions_app_status_idx" ON "subscriptions" USING btree ("application_id","status");--> statement-breakpoint
CREATE INDEX "subscriptions_plan_idx" ON "subscriptions" USING btree ("plan_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_provider_id_idx" ON "subscriptions" USING btree ("billing_provider","app_user_id","provider_subscription_id");--> statement-breakpoint
CREATE INDEX "balance_lots_open_idx" ON "balance_lots" USING btree ("app_user_id","unit_id","expires_at") WHERE "balance_lots"."remaining" > 0;--> statement-breakpoint
CREATE INDEX "balance_lots_due_idx" ON "balance_lots" USING btree ("expires_at") WHERE "balance_lots"."remaining" > 0 AND "balance_lots"."expires_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "balance_lots_subscription_idx" ON "balance_lots" USING btree ("subscription_id");--> statement-breakpoint
CREATE INDEX "ai_conversations_user_updated_idx" ON "ai_conversations" USING btree ("rxlab_user_id","updated_at");--> statement-breakpoint
CREATE INDEX "ai_messages_conversation_created_idx" ON "ai_messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_app_created_idx" ON "audit_logs" USING btree ("application_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "test_run_cases_run_idx" ON "test_run_cases" USING btree ("run_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "test_run_events_run_seq_idx" ON "test_run_events" USING btree ("run_id","seq");--> statement-breakpoint
CREATE INDEX "test_runs_suite_started_idx" ON "test_runs" USING btree ("suite_id","started_at");--> statement-breakpoint
CREATE INDEX "test_runs_app_started_idx" ON "test_runs" USING btree ("application_id","started_at");--> statement-breakpoint
CREATE INDEX "test_suites_app_idx" ON "test_suites" USING btree ("application_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "test_suites_app_name_idx" ON "test_suites" USING btree ("application_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "paywall_versions_paywall_version_idx" ON "paywall_versions" USING btree ("paywall_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "paywalls_name_idx" ON "paywalls" USING btree ("name");
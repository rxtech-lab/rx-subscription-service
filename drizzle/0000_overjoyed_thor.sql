CREATE TABLE `application_api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`application_id` text NOT NULL,
	`name` text NOT NULL,
	`key_prefix` text NOT NULL,
	`hashed_key` text NOT NULL,
	`last_used_at` integer,
	`revoked_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `application_api_keys_hashed_key_unique` ON `application_api_keys` (`hashed_key`);--> statement-breakpoint
CREATE INDEX `application_api_keys_app_idx` ON `application_api_keys` (`application_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `application_api_keys_hash_idx` ON `application_api_keys` (`hashed_key`);--> statement-breakpoint
CREATE TABLE `applications` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`icon_url` text,
	`status` text DEFAULT 'active' NOT NULL,
	`default_currency` text DEFAULT 'usd' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`synced_at` integer
);
--> statement-breakpoint
CREATE TABLE `balance_units` (
	`id` text PRIMARY KEY NOT NULL,
	`application_id` text NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`symbol` text,
	`precision` integer DEFAULT 0 NOT NULL,
	`kind` text DEFAULT 'points' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "balance_units_precision_range" CHECK("balance_units"."precision" >= 0 AND "balance_units"."precision" <= 9)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `balance_units_app_key_idx` ON `balance_units` (`application_id`,`key`);--> statement-breakpoint
CREATE TABLE `point_rates` (
	`id` text PRIMARY KEY NOT NULL,
	`application_id` text NOT NULL,
	`unit_id` text NOT NULL,
	`currency` text NOT NULL,
	`nano_minor_per_unit` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`unit_id`) REFERENCES `balance_units`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "point_rates_positive" CHECK("point_rates"."nano_minor_per_unit" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `point_rates_unit_currency_idx` ON `point_rates` (`unit_id`,`currency`);--> statement-breakpoint
CREATE INDEX `point_rates_app_idx` ON `point_rates` (`application_id`);--> statement-breakpoint
CREATE TABLE `permissions` (
	`id` text PRIMARY KEY NOT NULL,
	`application_id` text NOT NULL,
	`key` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`supports_all` integer DEFAULT true NOT NULL,
	`supports_ids` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `permissions_app_key_idx` ON `permissions` (`application_id`,`key`);--> statement-breakpoint
CREATE TABLE `role_permissions` (
	`id` text PRIMARY KEY NOT NULL,
	`role_id` text NOT NULL,
	`permission_id` text NOT NULL,
	`scope` text NOT NULL,
	`target_ids` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`role_id`) REFERENCES `subscription_roles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`permission_id`) REFERENCES `permissions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `role_permissions_role_permission_idx` ON `role_permissions` (`role_id`,`permission_id`);--> statement-breakpoint
CREATE INDEX `role_permissions_permission_idx` ON `role_permissions` (`permission_id`);--> statement-breakpoint
CREATE TABLE `subscription_roles` (
	`id` text PRIMARY KEY NOT NULL,
	`application_id` text NOT NULL,
	`key` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`is_default` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `subscription_roles_app_key_idx` ON `subscription_roles` (`application_id`,`key`);--> statement-breakpoint
CREATE TABLE `plan_entitlements` (
	`id` text PRIMARY KEY NOT NULL,
	`plan_id` text NOT NULL,
	`kind` text NOT NULL,
	`role_id` text,
	`permission_key` text,
	`permission_scope` text,
	`permission_target_ids` text,
	`usage_item_id` text,
	`limit_value` integer,
	`unit_id` text,
	`amount` integer,
	`feature_key` text,
	`feature_value` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`role_id`) REFERENCES `subscription_roles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`usage_item_id`) REFERENCES `usage_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`unit_id`) REFERENCES `balance_units`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `plan_entitlements_plan_idx` ON `plan_entitlements` (`plan_id`);--> statement-breakpoint
CREATE TABLE `plans` (
	`id` text PRIMARY KEY NOT NULL,
	`application_id` text NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`billing_interval` text NOT NULL,
	`interval_count` integer DEFAULT 1 NOT NULL,
	`price_amount_cents` integer NOT NULL,
	`currency` text DEFAULT 'usd' NOT NULL,
	`trial_days` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`stripe_product_id` text,
	`stripe_price_id` text,
	`metadata` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "plans_price_nonnegative" CHECK("plans"."price_amount_cents" >= 0),
	CONSTRAINT "plans_interval_count_positive" CHECK("plans"."interval_count" >= 1),
	CONSTRAINT "plans_trial_nonnegative" CHECK("plans"."trial_days" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `plans_app_key_idx` ON `plans` (`application_id`,`key`);--> statement-breakpoint
CREATE INDEX `plans_app_status_idx` ON `plans` (`application_id`,`status`);--> statement-breakpoint
CREATE TABLE `usage_counters` (
	`id` text PRIMARY KEY NOT NULL,
	`app_user_id` text NOT NULL,
	`usage_item_id` text NOT NULL,
	`period_start` integer NOT NULL,
	`period_end` integer,
	`used` integer DEFAULT 0 NOT NULL,
	`limit_value` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`app_user_id`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`usage_item_id`) REFERENCES `usage_items`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "usage_counters_used_nonnegative" CHECK("usage_counters"."used" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `usage_counters_user_item_period_idx` ON `usage_counters` (`app_user_id`,`usage_item_id`,`period_start`);--> statement-breakpoint
CREATE INDEX `usage_counters_user_item_idx` ON `usage_counters` (`app_user_id`,`usage_item_id`);--> statement-breakpoint
CREATE TABLE `usage_items` (
	`id` text PRIMARY KEY NOT NULL,
	`application_id` text NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`value_type` text DEFAULT 'counter' NOT NULL,
	`reset_policy` text DEFAULT 'never' NOT NULL,
	`reset_interval_count` integer,
	`reset_interval_unit` text,
	`default_limit` integer,
	`overage_policy` text DEFAULT 'block' NOT NULL,
	`overage_unit_id` text,
	`overage_cost_per_unit` integer,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`metadata` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`overage_unit_id`) REFERENCES `balance_units`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "usage_items_interval_positive" CHECK("usage_items"."reset_interval_count" IS NULL OR "usage_items"."reset_interval_count" >= 1),
	CONSTRAINT "usage_items_limit_nonnegative" CHECK("usage_items"."default_limit" IS NULL OR "usage_items"."default_limit" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `usage_items_app_key_idx` ON `usage_items` (`application_id`,`key`);--> statement-breakpoint
CREATE TABLE `usage_records` (
	`id` text PRIMARY KEY NOT NULL,
	`app_user_id` text NOT NULL,
	`usage_item_id` text NOT NULL,
	`counter_id` text,
	`amount` integer NOT NULL,
	`used_after` integer NOT NULL,
	`charged_units` integer DEFAULT 0 NOT NULL,
	`idempotency_key` text NOT NULL,
	`metadata` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`app_user_id`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`usage_item_id`) REFERENCES `usage_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`counter_id`) REFERENCES `usage_counters`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `usage_records_idempotency_key_unique` ON `usage_records` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `usage_records_user_created_idx` ON `usage_records` (`app_user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `usage_records_item_created_idx` ON `usage_records` (`usage_item_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `app_users` (
	`id` text PRIMARY KEY NOT NULL,
	`application_id` text NOT NULL,
	`rxlab_user_id` text NOT NULL,
	`email` text,
	`display_name` text,
	`level` integer DEFAULT 0 NOT NULL,
	`level_key` text,
	`external_ref` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `app_users_app_rxlab_idx` ON `app_users` (`application_id`,`rxlab_user_id`);--> statement-breakpoint
CREATE INDEX `app_users_rxlab_idx` ON `app_users` (`rxlab_user_id`);--> statement-breakpoint
CREATE TABLE `balances` (
	`id` text PRIMARY KEY NOT NULL,
	`app_user_id` text NOT NULL,
	`unit_id` text NOT NULL,
	`amount` integer DEFAULT 0 NOT NULL,
	`reserved` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`app_user_id`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`unit_id`) REFERENCES `balance_units`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "balances_reserved_nonnegative" CHECK("balances"."reserved" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `balances_user_unit_idx` ON `balances` (`app_user_id`,`unit_id`);--> statement-breakpoint
CREATE TABLE `ledger_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`app_user_id` text NOT NULL,
	`unit_id` text NOT NULL,
	`kind` text NOT NULL,
	`delta` integer NOT NULL,
	`balance_after` integer NOT NULL,
	`description` text NOT NULL,
	`reference_type` text,
	`reference_id` text,
	`idempotency_key` text NOT NULL,
	`metadata` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`app_user_id`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`unit_id`) REFERENCES `balance_units`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ledger_entries_idempotency_key_unique` ON `ledger_entries` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `ledger_entries_user_created_idx` ON `ledger_entries` (`app_user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ledger_entries_reference_idx` ON `ledger_entries` (`reference_type`,`reference_id`);--> statement-breakpoint
CREATE TABLE `topup_eligibility_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`topup_product_id` text NOT NULL,
	`rule_type` text NOT NULL,
	`plan_id` text,
	`role_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`topup_product_id`) REFERENCES `topup_products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`role_id`) REFERENCES `subscription_roles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `topup_eligibility_rules_product_idx` ON `topup_eligibility_rules` (`topup_product_id`);--> statement-breakpoint
CREATE TABLE `topup_products` (
	`id` text PRIMARY KEY NOT NULL,
	`application_id` text NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`unit_id` text NOT NULL,
	`amount` integer NOT NULL,
	`price_amount_cents` integer NOT NULL,
	`currency` text DEFAULT 'usd' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`max_purchases_per_user` integer,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`stripe_product_id` text,
	`stripe_price_id` text,
	`metadata` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`unit_id`) REFERENCES `balance_units`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "topup_products_amount_positive" CHECK("topup_products"."amount" > 0),
	CONSTRAINT "topup_products_price_nonnegative" CHECK("topup_products"."price_amount_cents" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `topup_products_app_key_idx` ON `topup_products` (`application_id`,`key`);--> statement-breakpoint
CREATE INDEX `topup_products_app_status_idx` ON `topup_products` (`application_id`,`status`);--> statement-breakpoint
CREATE TABLE `purchases` (
	`id` text PRIMARY KEY NOT NULL,
	`application_id` text NOT NULL,
	`app_user_id` text NOT NULL,
	`kind` text NOT NULL,
	`plan_id` text,
	`topup_product_id` text,
	`unit_id` text,
	`units_granted` integer DEFAULT 0 NOT NULL,
	`amount_cents` integer NOT NULL,
	`currency` text DEFAULT 'usd' NOT NULL,
	`status` text NOT NULL,
	`stripe_checkout_session_id` text,
	`stripe_payment_intent_id` text,
	`stripe_invoice_id` text,
	`hosted_invoice_url` text,
	`invoice_pdf_url` text,
	`refunded_amount_cents` integer DEFAULT 0 NOT NULL,
	`reversed_units` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`paid_at` integer,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`app_user_id`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`topup_product_id`) REFERENCES `topup_products`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`unit_id`) REFERENCES `balance_units`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "purchases_refund_nonnegative" CHECK("purchases"."refunded_amount_cents" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `purchases_stripe_checkout_session_id_unique` ON `purchases` (`stripe_checkout_session_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `purchases_stripe_payment_intent_id_unique` ON `purchases` (`stripe_payment_intent_id`);--> statement-breakpoint
CREATE INDEX `purchases_user_created_idx` ON `purchases` (`app_user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `purchases_app_created_idx` ON `purchases` (`application_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `stripe_customers` (
	`id` text PRIMARY KEY NOT NULL,
	`app_user_id` text NOT NULL,
	`stripe_customer_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`app_user_id`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `stripe_customers_app_user_id_unique` ON `stripe_customers` (`app_user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `stripe_customers_stripe_customer_id_unique` ON `stripe_customers` (`stripe_customer_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `stripe_customers_customer_idx` ON `stripe_customers` (`stripe_customer_id`);--> statement-breakpoint
CREATE TABLE `stripe_webhook_events` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`status` text NOT NULL,
	`object_id` text,
	`failure_code` text,
	`created_at` integer NOT NULL,
	`processed_at` integer
);
--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`application_id` text NOT NULL,
	`app_user_id` text NOT NULL,
	`plan_id` text NOT NULL,
	`status` text NOT NULL,
	`current_period_start` integer,
	`current_period_end` integer,
	`cancel_at_period_end` integer DEFAULT false NOT NULL,
	`stripe_subscription_id` text,
	`stripe_customer_id` text,
	`entitlement_snapshot` text,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`app_user_id`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `subscriptions_stripe_subscription_id_unique` ON `subscriptions` (`stripe_subscription_id`);--> statement-breakpoint
CREATE INDEX `subscriptions_user_status_idx` ON `subscriptions` (`app_user_id`,`status`);--> statement-breakpoint
CREATE INDEX `subscriptions_app_status_idx` ON `subscriptions` (`application_id`,`status`);--> statement-breakpoint
CREATE INDEX `subscriptions_plan_idx` ON `subscriptions` (`plan_id`);--> statement-breakpoint
CREATE TABLE `ai_conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`application_id` text,
	`rxlab_user_id` text NOT NULL,
	`title` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ai_conversations_user_updated_idx` ON `ai_conversations` (`rxlab_user_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `ai_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`role` text NOT NULL,
	`parts` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `ai_conversations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ai_messages_conversation_created_idx` ON `ai_messages` (`conversation_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`application_id` text,
	`actor_type` text NOT NULL,
	`actor_id` text,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text,
	`before` text,
	`after` text,
	`conversation_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `audit_logs_app_created_idx` ON `audit_logs` (`application_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_logs_entity_idx` ON `audit_logs` (`entity_type`,`entity_id`);
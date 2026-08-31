CREATE TABLE `apple_store_integrations` (
	`id` text PRIMARY KEY NOT NULL,
	`application_id` text NOT NULL,
	`bundle_id` text NOT NULL,
	`app_apple_id` integer NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "apple_store_app_id_positive" CHECK("apple_store_integrations"."app_apple_id" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `apple_store_integrations_application_id_unique` ON `apple_store_integrations` (`application_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `apple_store_integrations_bundle_id_unique` ON `apple_store_integrations` (`bundle_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `apple_store_integrations_app_apple_id_unique` ON `apple_store_integrations` (`app_apple_id`);--> statement-breakpoint
CREATE TABLE `store_account_links` (
	`id` text PRIMARY KEY NOT NULL,
	`application_id` text NOT NULL,
	`app_user_id` text NOT NULL,
	`provider` text NOT NULL,
	`provider_account_token` text NOT NULL,
	`consumption_data_consent` integer DEFAULT false NOT NULL,
	`consent_updated_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`app_user_id`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `store_accounts_user_provider_idx` ON `store_account_links` (`app_user_id`,`provider`);--> statement-breakpoint
CREATE UNIQUE INDEX `store_accounts_provider_token_idx` ON `store_account_links` (`provider`,`provider_account_token`);--> statement-breakpoint
CREATE INDEX `store_accounts_app_idx` ON `store_account_links` (`application_id`);--> statement-breakpoint
CREATE TABLE `store_product_mappings` (
	`id` text PRIMARY KEY NOT NULL,
	`application_id` text NOT NULL,
	`provider` text NOT NULL,
	`product_id` text NOT NULL,
	`product_type` text NOT NULL,
	`plan_id` text,
	`topup_product_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`topup_product_id`) REFERENCES `topup_products`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "store_products_exactly_one_target" CHECK(("store_product_mappings"."plan_id" IS NOT NULL AND "store_product_mappings"."topup_product_id" IS NULL) OR ("store_product_mappings"."plan_id" IS NULL AND "store_product_mappings"."topup_product_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `store_products_app_provider_product_idx` ON `store_product_mappings` (`application_id`,`provider`,`product_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `store_products_provider_plan_idx` ON `store_product_mappings` (`provider`,`plan_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `store_products_provider_topup_idx` ON `store_product_mappings` (`provider`,`topup_product_id`);--> statement-breakpoint
CREATE TABLE `store_provider_events` (
	`id` text PRIMARY KEY NOT NULL,
	`application_id` text NOT NULL,
	`provider` text NOT NULL,
	`environment` text NOT NULL,
	`provider_event_id` text NOT NULL,
	`type` text NOT NULL,
	`subtype` text,
	`status` text NOT NULL,
	`signed_at` integer,
	`signed_payload` text NOT NULL,
	`failure_code` text,
	`created_at` integer NOT NULL,
	`processed_at` integer,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `store_events_provider_event_idx` ON `store_provider_events` (`provider`,`provider_event_id`);--> statement-breakpoint
CREATE INDEX `store_events_app_status_idx` ON `store_provider_events` (`application_id`,`status`);--> statement-breakpoint
CREATE TABLE `store_reconciliation_cursors` (
	`id` text PRIMARY KEY NOT NULL,
	`application_id` text NOT NULL,
	`provider` text NOT NULL,
	`environment` text NOT NULL,
	`last_synced_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `store_reconciliation_app_provider_env_idx` ON `store_reconciliation_cursors` (`application_id`,`provider`,`environment`);--> statement-breakpoint
CREATE TABLE `store_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`application_id` text NOT NULL,
	`app_user_id` text NOT NULL,
	`provider` text NOT NULL,
	`environment` text NOT NULL,
	`transaction_id` text NOT NULL,
	`original_transaction_id` text NOT NULL,
	`product_id` text NOT NULL,
	`product_type` text NOT NULL,
	`quantity` integer DEFAULT 1 NOT NULL,
	`price_milliunits` integer,
	`currency` text,
	`purchase_at` integer NOT NULL,
	`expires_at` integer,
	`revoked_at` integer,
	`revocation_percentage` integer DEFAULT 0 NOT NULL,
	`signed_at` integer NOT NULL,
	`signed_transaction` text NOT NULL,
	`subscription_id` text,
	`purchase_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`app_user_id`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`subscription_id`) REFERENCES `subscriptions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`purchase_id`) REFERENCES `purchases`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "store_transactions_quantity_positive" CHECK("store_transactions"."quantity" >= 1),
	CONSTRAINT "store_transactions_revocation_percentage" CHECK("store_transactions"."revocation_percentage" >= 0 AND "store_transactions"."revocation_percentage" <= 100000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `store_transactions_provider_transaction_idx` ON `store_transactions` (`provider`,`transaction_id`);--> statement-breakpoint
CREATE INDEX `store_transactions_original_idx` ON `store_transactions` (`provider`,`original_transaction_id`);--> statement-breakpoint
CREATE INDEX `store_transactions_user_idx` ON `store_transactions` (`app_user_id`,`purchase_at`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_purchases` (
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
	`billing_provider` text DEFAULT 'stripe' NOT NULL,
	`provider_transaction_id` text,
	`provider_original_transaction_id` text,
	`provider_product_id` text,
	`quantity` integer DEFAULT 1 NOT NULL,
	`price_milliunits` integer,
	`entitlement_snapshot` text,
	`fulfillment_failure_code` text,
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
	CONSTRAINT "purchases_quantity_positive" CHECK("__new_purchases"."quantity" >= 1),
	CONSTRAINT "purchases_refund_nonnegative" CHECK("__new_purchases"."refunded_amount_cents" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_purchases`("id", "application_id", "app_user_id", "kind", "plan_id", "topup_product_id", "unit_id", "units_granted", "amount_cents", "currency", "status", "billing_provider", "provider_transaction_id", "provider_original_transaction_id", "provider_product_id", "quantity", "price_milliunits", "entitlement_snapshot", "fulfillment_failure_code", "stripe_checkout_session_id", "stripe_payment_intent_id", "stripe_invoice_id", "hosted_invoice_url", "invoice_pdf_url", "refunded_amount_cents", "reversed_units", "created_at", "updated_at", "paid_at") SELECT "id", "application_id", "app_user_id", "kind", "plan_id", "topup_product_id", "unit_id", "units_granted", "amount_cents", "currency", "status", 'stripe', COALESCE("stripe_payment_intent_id", "stripe_checkout_session_id"), NULL, NULL, 1, NULL, NULL, NULL, "stripe_checkout_session_id", "stripe_payment_intent_id", "stripe_invoice_id", "hosted_invoice_url", "invoice_pdf_url", "refunded_amount_cents", "reversed_units", "created_at", "updated_at", "paid_at" FROM `purchases`;--> statement-breakpoint
DROP TABLE `purchases`;--> statement-breakpoint
ALTER TABLE `__new_purchases` RENAME TO `purchases`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `purchases_stripe_checkout_session_id_unique` ON `purchases` (`stripe_checkout_session_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `purchases_stripe_payment_intent_id_unique` ON `purchases` (`stripe_payment_intent_id`);--> statement-breakpoint
CREATE INDEX `purchases_user_created_idx` ON `purchases` (`app_user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `purchases_app_created_idx` ON `purchases` (`application_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `purchases_provider_transaction_idx` ON `purchases` (`billing_provider`,`provider_transaction_id`);--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `billing_provider` text DEFAULT 'stripe' NOT NULL;--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `provider_subscription_id` text;--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `provider_product_id` text;--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `provider_signed_at` integer;--> statement-breakpoint
UPDATE `subscriptions` SET `provider_subscription_id` = `stripe_subscription_id` WHERE `stripe_subscription_id` IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `subscriptions_provider_id_idx` ON `subscriptions` (`billing_provider`,`provider_subscription_id`);

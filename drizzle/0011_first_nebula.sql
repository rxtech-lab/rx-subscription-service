CREATE TABLE `balance_lots` (
	`id` text PRIMARY KEY NOT NULL,
	`app_user_id` text NOT NULL,
	`unit_id` text NOT NULL,
	`ledger_entry_id` text,
	`original_amount` integer NOT NULL,
	`remaining` integer NOT NULL,
	`expires_at` integer,
	`expiry_policy` text DEFAULT 'never' NOT NULL,
	`expiry_months` integer,
	`subscription_id` text,
	`plan_id` text,
	`expired_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`app_user_id`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`unit_id`) REFERENCES `balance_units`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`ledger_entry_id`) REFERENCES `ledger_entries`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`subscription_id`) REFERENCES `subscriptions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "balance_lots_remaining_nonnegative" CHECK("balance_lots"."remaining" >= 0),
	CONSTRAINT "balance_lots_remaining_within_original" CHECK("balance_lots"."remaining" <= "balance_lots"."original_amount")
);
--> statement-breakpoint
CREATE INDEX `balance_lots_open_idx` ON `balance_lots` (`app_user_id`,`unit_id`,`expires_at`) WHERE "balance_lots"."remaining" > 0;--> statement-breakpoint
CREATE INDEX `balance_lots_due_idx` ON `balance_lots` (`expires_at`) WHERE "balance_lots"."remaining" > 0 AND "balance_lots"."expires_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `balance_lots_subscription_idx` ON `balance_lots` (`subscription_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_plan_entitlements` (
	`id` text PRIMARY KEY NOT NULL,
	`plan_id` text NOT NULL,
	`kind` text NOT NULL,
	`role_id` text,
	`permission_key` text,
	`permission_scope` text,
	`permission_target_ids` text,
	`usage_item_id` text,
	`limit_value` integer,
	`trial_limit_value` integer,
	`unit_id` text,
	`amount` integer,
	`balance_expiry_policy` text DEFAULT 'never' NOT NULL,
	`balance_expiry_months` integer,
	`feature_key` text,
	`feature_value` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`role_id`) REFERENCES `subscription_roles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`usage_item_id`) REFERENCES `usage_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`unit_id`) REFERENCES `balance_units`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "plan_entitlements_expiry_months_positive" CHECK("__new_plan_entitlements"."balance_expiry_months" IS NULL OR "__new_plan_entitlements"."balance_expiry_months" >= 1),
	CONSTRAINT "plan_entitlements_expiry_months_required" CHECK("__new_plan_entitlements"."balance_expiry_policy" NOT IN ('duration', 'after_plan_end') OR "__new_plan_entitlements"."balance_expiry_months" IS NOT NULL)
);
--> statement-breakpoint
INSERT INTO `__new_plan_entitlements`("id", "plan_id", "kind", "role_id", "permission_key", "permission_scope", "permission_target_ids", "usage_item_id", "limit_value", "trial_limit_value", "unit_id", "amount", "feature_key", "feature_value", "created_at", "updated_at") SELECT "id", "plan_id", "kind", "role_id", "permission_key", "permission_scope", "permission_target_ids", "usage_item_id", "limit_value", "trial_limit_value", "unit_id", "amount", "feature_key", "feature_value", "created_at", "updated_at" FROM `plan_entitlements`;--> statement-breakpoint
DROP TABLE `plan_entitlements`;--> statement-breakpoint
ALTER TABLE `__new_plan_entitlements` RENAME TO `plan_entitlements`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `plan_entitlements_plan_idx` ON `plan_entitlements` (`plan_id`);--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `trial_watch_run_id` text;--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `trial_watch_ends_at` integer;--> statement-breakpoint
--
-- Back-fill one non-expiring lot per existing balance.
--
-- Every unit granted before this migration was granted under the only policy
-- that existed — they accumulate for good — so they get a lot with no expiry.
-- Without this the invariant `SUM(remaining) = MAX(0, balances.amount)` would
-- start out violated for every current user, and `listUpcomingExpiries` would
-- report a balance as entirely unaccounted for.
--
-- Negative balances (units clawed back after they were spent) are skipped: they
-- are a debt, not a tranche, and the next credit settles them.
INSERT INTO `balance_lots` (
  "id", "app_user_id", "unit_id", "ledger_entry_id", "original_amount",
  "remaining", "expires_at", "expiry_policy", "expiry_months",
  "subscription_id", "plan_id", "expired_at", "created_at", "updated_at"
)
SELECT
  lower(hex(randomblob(16))),
  "app_user_id",
  "unit_id",
  NULL,
  "amount",
  "amount",
  NULL,
  'never',
  NULL,
  NULL,
  NULL,
  NULL,
  "created_at",
  "updated_at"
FROM `balances`
WHERE "amount" > 0;
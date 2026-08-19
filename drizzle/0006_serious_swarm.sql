CREATE TABLE `coupons` (
	`id` text PRIMARY KEY NOT NULL,
	`application_id` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`discount_type` text NOT NULL,
	`percent_basis_points` integer,
	`amount_off_cents` integer,
	`currency` text DEFAULT 'usd' NOT NULL,
	`max_discount_cents` integer,
	`duration` text DEFAULT 'once' NOT NULL,
	`duration_in_months` integer,
	`applies_to` text DEFAULT 'all' NOT NULL,
	`restrict_to_users` integer DEFAULT false NOT NULL,
	`max_redemptions` integer,
	`max_redemptions_per_user` integer,
	`minimum_amount_cents` integer,
	`first_time_only` integer DEFAULT false NOT NULL,
	`starts_at` integer,
	`redeem_by` integer,
	`status` text DEFAULT 'draft' NOT NULL,
	`stripe_coupon_id` text,
	`stripe_sandbox_coupon_id` text,
	`metadata` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "coupons_percent_range" CHECK("coupons"."percent_basis_points" is null or ("coupons"."percent_basis_points" > 0 and "coupons"."percent_basis_points" <= 10000)),
	CONSTRAINT "coupons_amount_positive" CHECK("coupons"."amount_off_cents" is null or "coupons"."amount_off_cents" > 0),
	CONSTRAINT "coupons_max_discount_positive" CHECK("coupons"."max_discount_cents" is null or "coupons"."max_discount_cents" > 0),
	CONSTRAINT "coupons_duration_months" CHECK("coupons"."duration" <> 'repeating' or "coupons"."duration_in_months" >= 1),
	CONSTRAINT "coupons_discount_shape" CHECK(("coupons"."discount_type" = 'percent' and "coupons"."percent_basis_points" is not null and "coupons"."amount_off_cents" is null) or ("coupons"."discount_type" = 'amount' and "coupons"."amount_off_cents" is not null and "coupons"."percent_basis_points" is null)),
	CONSTRAINT "coupons_usage_limits" CHECK(("coupons"."max_redemptions" is null or "coupons"."max_redemptions" > 0) and ("coupons"."max_redemptions_per_user" is null or "coupons"."max_redemptions_per_user" > 0) and ("coupons"."minimum_amount_cents" is null or "coupons"."minimum_amount_cents" >= 0)),
	CONSTRAINT "coupons_redemption_window" CHECK("coupons"."starts_at" is null or "coupons"."redeem_by" is null or "coupons"."starts_at" < "coupons"."redeem_by")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `coupons_app_code_idx` ON `coupons` (`application_id`,`code`);--> statement-breakpoint
CREATE INDEX `coupons_app_status_idx` ON `coupons` (`application_id`,`status`);--> statement-breakpoint
CREATE TABLE `coupon_targets` (
	`id` text PRIMARY KEY NOT NULL,
	`coupon_id` text NOT NULL,
	`plan_id` text,
	`topup_product_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`coupon_id`) REFERENCES `coupons`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`topup_product_id`) REFERENCES `topup_products`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "coupon_targets_exactly_one_target" CHECK(("coupon_targets"."plan_id" is not null and "coupon_targets"."topup_product_id" is null) or ("coupon_targets"."plan_id" is null and "coupon_targets"."topup_product_id" is not null))
);
--> statement-breakpoint
CREATE INDEX `coupon_targets_coupon_idx` ON `coupon_targets` (`coupon_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `coupon_targets_plan_idx` ON `coupon_targets` (`coupon_id`,`plan_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `coupon_targets_topup_idx` ON `coupon_targets` (`coupon_id`,`topup_product_id`);--> statement-breakpoint
CREATE TABLE `coupon_users` (
	`id` text PRIMARY KEY NOT NULL,
	`coupon_id` text NOT NULL,
	`app_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`coupon_id`) REFERENCES `coupons`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`app_user_id`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `coupon_users_coupon_user_idx` ON `coupon_users` (`coupon_id`,`app_user_id`);--> statement-breakpoint
CREATE TABLE `coupon_redemptions` (
	`id` text PRIMARY KEY NOT NULL,
	`coupon_id` text NOT NULL,
	`application_id` text NOT NULL,
	`app_user_id` text NOT NULL,
	`status` text DEFAULT 'reserved' NOT NULL,
	`plan_id` text,
	`topup_product_id` text,
	`purchase_id` text,
	`discount_cents` integer DEFAULT 0 NOT NULL,
	`currency` text DEFAULT 'usd' NOT NULL,
	`stripe_coupon_id` text,
	`stripe_checkout_session_id` text,
	`created_at` integer NOT NULL,
	`redeemed_at` integer,
	FOREIGN KEY (`coupon_id`) REFERENCES `coupons`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`app_user_id`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`topup_product_id`) REFERENCES `topup_products`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "coupon_redemptions_at_most_one_target" CHECK("coupon_redemptions"."plan_id" is null or "coupon_redemptions"."topup_product_id" is null)
);
--> statement-breakpoint
CREATE INDEX `coupon_redemptions_coupon_status_idx` ON `coupon_redemptions` (`coupon_id`,`status`);--> statement-breakpoint
CREATE INDEX `coupon_redemptions_user_idx` ON `coupon_redemptions` (`coupon_id`,`app_user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `coupon_redemptions_session_idx` ON `coupon_redemptions` (`stripe_checkout_session_id`);

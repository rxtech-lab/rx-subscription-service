CREATE TABLE `app_user_roles` (
	`id` text PRIMARY KEY NOT NULL,
	`app_user_id` text NOT NULL,
	`role_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`app_user_id`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`role_id`) REFERENCES `subscription_roles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `app_user_roles_user_role_idx` ON `app_user_roles` (`app_user_id`,`role_id`);--> statement-breakpoint
CREATE INDEX `app_user_roles_role_idx` ON `app_user_roles` (`role_id`);--> statement-breakpoint
CREATE TABLE `app_user_usage_limits` (
	`id` text PRIMARY KEY NOT NULL,
	`app_user_id` text NOT NULL,
	`usage_item_id` text NOT NULL,
	`limit_value` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`app_user_id`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`usage_item_id`) REFERENCES `usage_items`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "app_user_usage_limits_nonnegative" CHECK("app_user_usage_limits"."limit_value" IS NULL OR "app_user_usage_limits"."limit_value" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `app_user_usage_limits_user_item_idx` ON `app_user_usage_limits` (`app_user_id`,`usage_item_id`);
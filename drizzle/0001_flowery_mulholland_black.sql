ALTER TABLE `plans` ADD `stripe_sandbox_product_id` text;--> statement-breakpoint
ALTER TABLE `plans` ADD `stripe_sandbox_price_id` text;--> statement-breakpoint
ALTER TABLE `app_users` ADD `is_test` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `app_users` ADD `test_note` text;--> statement-breakpoint
CREATE INDEX `app_users_app_test_idx` ON `app_users` (`application_id`,`is_test`);--> statement-breakpoint
ALTER TABLE `topup_products` ADD `stripe_sandbox_product_id` text;--> statement-breakpoint
ALTER TABLE `topup_products` ADD `stripe_sandbox_price_id` text;
DROP INDEX `store_transactions_provider_transaction_idx`;--> statement-breakpoint
DROP INDEX `store_transactions_original_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `store_transactions_provider_transaction_idx` ON `store_transactions` (`provider`,`app_user_id`,`transaction_id`);--> statement-breakpoint
CREATE INDEX `store_transactions_original_idx` ON `store_transactions` (`provider`,`app_user_id`,`original_transaction_id`);--> statement-breakpoint
DROP INDEX `purchases_provider_transaction_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `purchases_provider_transaction_idx` ON `purchases` (`billing_provider`,`app_user_id`,`provider_transaction_id`);--> statement-breakpoint
DROP INDEX `subscriptions_provider_id_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `subscriptions_provider_id_idx` ON `subscriptions` (`billing_provider`,`app_user_id`,`provider_subscription_id`);
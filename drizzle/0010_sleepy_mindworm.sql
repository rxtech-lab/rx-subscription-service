DROP INDEX `app_users_app_rxlab_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `app_users_app_rxlab_env_idx` ON `app_users` (`application_id`,`rxlab_user_id`,`is_test`);--> statement-breakpoint
ALTER TABLE `application_api_keys` ADD `environment` text DEFAULT 'production' NOT NULL;
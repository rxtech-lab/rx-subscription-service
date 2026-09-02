DROP INDEX `app_users_app_rxlab_env_idx`;--> statement-breakpoint
ALTER TABLE `app_users` ADD `environment` text DEFAULT 'production' NOT NULL;--> statement-breakpoint
UPDATE `app_users` SET `environment` = CASE WHEN `is_test` = 1 THEN 'sandbox' ELSE 'production' END;--> statement-breakpoint
CREATE INDEX `app_users_app_environment_idx` ON `app_users` (`application_id`,`environment`);--> statement-breakpoint
CREATE UNIQUE INDEX `app_users_app_rxlab_env_idx` ON `app_users` (`application_id`,`rxlab_user_id`,`environment`);

ALTER TABLE `plans` ADD `plan_group` text DEFAULT 'default' NOT NULL;--> statement-breakpoint
CREATE INDEX `plans_app_group_idx` ON `plans` (`application_id`,`plan_group`);
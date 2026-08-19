CREATE TABLE `test_run_cases` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`suite_name` text NOT NULL,
	`name` text NOT NULL,
	`status` text NOT NULL,
	`position` integer NOT NULL,
	`duration_ms` integer,
	`error` text,
	`steps` text DEFAULT '[]' NOT NULL,
	`started_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `test_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `test_run_cases_run_idx` ON `test_run_cases` (`run_id`,`position`);--> statement-breakpoint
CREATE TABLE `test_run_events` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`seq` integer NOT NULL,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `test_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `test_run_events_run_seq_idx` ON `test_run_events` (`run_id`,`seq`);--> statement-breakpoint
CREATE TABLE `test_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`application_id` text NOT NULL,
	`suite_id` text NOT NULL,
	`code` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`trigger` text DEFAULT 'console' NOT NULL,
	`triggered_by` text,
	`conversation_id` text,
	`driver` text DEFAULT 'sandbox' NOT NULL,
	`total` integer DEFAULT 0 NOT NULL,
	`passed` integer DEFAULT 0 NOT NULL,
	`failed` integer DEFAULT 0 NOT NULL,
	`skipped` integer DEFAULT 0 NOT NULL,
	`duration_ms` integer,
	`error` text,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`suite_id`) REFERENCES `test_suites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `test_runs_suite_started_idx` ON `test_runs` (`suite_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `test_runs_app_started_idx` ON `test_runs` (`application_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `test_suites` (
	`id` text PRIMARY KEY NOT NULL,
	`application_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`code` text NOT NULL,
	`updated_by` text DEFAULT 'user' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `test_suites_app_idx` ON `test_suites` (`application_id`,`updated_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `test_suites_app_name_idx` ON `test_suites` (`application_id`,`name`);
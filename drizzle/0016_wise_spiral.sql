CREATE TABLE `paywalls` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`draft_spec` text NOT NULL,
	`published_spec` text,
	`updated_by` text DEFAULT 'user' NOT NULL,
	`created_by` text,
	`published_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `paywalls_name_idx` ON `paywalls` (`name`);--> statement-breakpoint
ALTER TABLE `applications` ADD `paywall_id` text REFERENCES paywalls(id) ON DELETE SET NULL;
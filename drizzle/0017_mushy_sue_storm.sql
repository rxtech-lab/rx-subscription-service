CREATE TABLE `paywall_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`paywall_id` text NOT NULL,
	`version` integer NOT NULL,
	`spec` text NOT NULL,
	`source` text NOT NULL,
	`restored_from_version` integer,
	`actor_type` text NOT NULL,
	`actor_id` text,
	`created_at` integer NOT NULL,
	`published_at` integer,
	FOREIGN KEY (`paywall_id`) REFERENCES `paywalls`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `paywall_versions_paywall_version_idx` ON `paywall_versions` (`paywall_id`,`version`);--> statement-breakpoint
INSERT INTO `paywall_versions` (
	`id`,
	`paywall_id`,
	`version`,
	`spec`,
	`source`,
	`actor_type`,
	`actor_id`,
	`created_at`,
	`published_at`
)
SELECT
	lower(hex(randomblob(16))),
	`id`,
	1,
	coalesce(`published_spec`, `draft_spec`),
	CASE WHEN `published_spec` IS NULL THEN 'initial' ELSE 'published' END,
	CASE WHEN `updated_by` = 'ai' THEN 'ai' ELSE 'user' END,
	`created_by`,
	`created_at`,
	`published_at`
FROM `paywalls`;--> statement-breakpoint
INSERT INTO `paywall_versions` (
	`id`,
	`paywall_id`,
	`version`,
	`spec`,
	`source`,
	`actor_type`,
	`actor_id`,
	`created_at`
)
SELECT
	lower(hex(randomblob(16))),
	`id`,
	2,
	`draft_spec`,
	'draft',
	CASE WHEN `updated_by` = 'ai' THEN 'ai' ELSE 'user' END,
	`created_by`,
	`updated_at`
FROM `paywalls`
WHERE `published_spec` IS NOT NULL AND `draft_spec` <> `published_spec`;

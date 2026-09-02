ALTER TABLE `application_api_keys` ADD `kind` text DEFAULT 'secret' NOT NULL;--> statement-breakpoint
ALTER TABLE `application_api_keys` ADD `allowed_client_ids` text;
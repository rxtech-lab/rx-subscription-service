ALTER TABLE `ai_conversations` ADD `summary` text;--> statement-breakpoint
ALTER TABLE `ai_conversations` ADD `summary_message_count` integer DEFAULT 0 NOT NULL;
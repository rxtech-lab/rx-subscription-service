ALTER TABLE "permissions" ADD COLUMN "permission_group" text;--> statement-breakpoint
ALTER TABLE "permissions" ADD COLUMN "scope_options" jsonb;
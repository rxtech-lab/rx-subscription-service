ALTER TABLE "permissions" ADD COLUMN IF NOT EXISTS "permission_group" text;--> statement-breakpoint
ALTER TABLE "permissions" ADD COLUMN IF NOT EXISTS "scope_options" jsonb;
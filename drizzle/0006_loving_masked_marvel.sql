CREATE TABLE "mcp_clients" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"redirect_uris" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_credentials" (
	"hash" text PRIMARY KEY NOT NULL,
	"grant_id" text NOT NULL,
	"kind" text NOT NULL,
	"redirect_uri" text,
	"challenge" text,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "mcp_grants" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"user_id" text NOT NULL,
	"resource" text NOT NULL,
	"scopes" jsonb NOT NULL,
	"application_ids" jsonb NOT NULL,
	"upstream_token" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "mcp_credentials" ADD CONSTRAINT "mcp_credentials_grant_id_mcp_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."mcp_grants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_grants" ADD CONSTRAINT "mcp_grants_client_id_mcp_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."mcp_clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mcp_grants_user_idx" ON "mcp_grants" USING btree ("user_id");
CREATE TABLE "topup_product_grants" (
	"id" text PRIMARY KEY NOT NULL,
	"topup_product_id" text NOT NULL,
	"unit_id" text NOT NULL,
	"amount" bigint NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "topup_product_grants_amount_positive" CHECK ("topup_product_grants"."amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "topup_product_grants" ADD CONSTRAINT "topup_product_grants_topup_product_id_topup_products_id_fk" FOREIGN KEY ("topup_product_id") REFERENCES "public"."topup_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topup_product_grants" ADD CONSTRAINT "topup_product_grants_unit_id_balance_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."balance_units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "topup_product_grants_product_unit_idx" ON "topup_product_grants" USING btree ("topup_product_id","unit_id");
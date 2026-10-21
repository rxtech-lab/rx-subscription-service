ALTER TABLE "topup_products" ADD COLUMN "eligibility_mode" text DEFAULT 'all' NOT NULL;--> statement-breakpoint
ALTER TABLE "topup_products" ADD CONSTRAINT "topup_products_eligibility_mode" CHECK ("topup_products"."eligibility_mode" in ('all', 'any'));

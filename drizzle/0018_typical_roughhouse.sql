CREATE TABLE `store_product_prices` (
	`id` text PRIMARY KEY NOT NULL,
	`store_product_mapping_id` text NOT NULL,
	`price_amount_cents` integer NOT NULL,
	`currency` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`store_product_mapping_id`) REFERENCES `store_product_mappings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `store_product_prices_store_product_mapping_id_unique` ON `store_product_prices` (`store_product_mapping_id`);
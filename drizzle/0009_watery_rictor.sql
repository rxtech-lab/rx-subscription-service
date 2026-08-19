CREATE TABLE `balance_reservation_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`application_id` text NOT NULL,
	`reservation_id` text NOT NULL,
	`kind` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`request_fingerprint` text NOT NULL,
	`response` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reservation_id`) REFERENCES `balance_reservations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `balance_reservation_operations_idempotency_key_unique` ON `balance_reservation_operations` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `balance_reservation_operations_reservation_idx` ON `balance_reservation_operations` (`reservation_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `balance_reservation_operations_app_idx` ON `balance_reservation_operations` (`application_id`);--> statement-breakpoint
CREATE TABLE `balance_reservations` (
	`id` text PRIMARY KEY NOT NULL,
	`application_id` text NOT NULL,
	`app_user_id` text NOT NULL,
	`unit_id` text NOT NULL,
	`initial_amount` integer NOT NULL,
	`amount` integer NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`description` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`request_fingerprint` text NOT NULL,
	`metadata` text,
	`available_after_reserve` integer NOT NULL,
	`ttl_seconds` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`requested_amount` integer DEFAULT 0 NOT NULL,
	`settled_amount` integer DEFAULT 0 NOT NULL,
	`released_amount` integer DEFAULT 0 NOT NULL,
	`shortfall_amount` integer DEFAULT 0 NOT NULL,
	`release_reason` text,
	`entry_id` text,
	`balance_after` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`closed_at` integer,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`app_user_id`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`unit_id`) REFERENCES `balance_units`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "balance_reservations_initial_positive" CHECK("balance_reservations"."initial_amount" > 0),
	CONSTRAINT "balance_reservations_amount_nonnegative" CHECK("balance_reservations"."amount" >= 0),
	CONSTRAINT "balance_reservations_available_nonnegative" CHECK("balance_reservations"."available_after_reserve" >= 0),
	CONSTRAINT "balance_reservations_requested_nonnegative" CHECK("balance_reservations"."requested_amount" >= 0),
	CONSTRAINT "balance_reservations_settled_nonnegative" CHECK("balance_reservations"."settled_amount" >= 0),
	CONSTRAINT "balance_reservations_released_nonnegative" CHECK("balance_reservations"."released_amount" >= 0),
	CONSTRAINT "balance_reservations_shortfall_nonnegative" CHECK("balance_reservations"."shortfall_amount" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `balance_reservations_idempotency_key_unique` ON `balance_reservations` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `balance_reservations_app_user_status_idx` ON `balance_reservations` (`application_id`,`app_user_id`,`status`);--> statement-breakpoint
CREATE INDEX `balance_reservations_expiry_idx` ON `balance_reservations` (`status`,`expires_at`);
ALTER TABLE `plan_entitlements` ADD `trial_amount` integer;--> statement-breakpoint
UPDATE `plan_entitlements`
SET `trial_amount` = `amount`
WHERE `kind` = 'balance_grant' AND `amount` IS NOT NULL;

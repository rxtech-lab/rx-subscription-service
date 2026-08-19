ALTER TABLE `plan_entitlements` ADD `trial_limit_value` integer;--> statement-breakpoint
UPDATE `plan_entitlements`
SET `trial_limit_value` = `limit_value`
WHERE `kind` = 'usage_limit';

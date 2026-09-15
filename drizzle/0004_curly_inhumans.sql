ALTER TABLE `contracts` ADD `resolution_source_name` text;--> statement-breakpoint
ALTER TABLE `contracts` ADD `resolution_source_url` text;--> statement-breakpoint
ALTER TABLE `contracts` ADD `measurement_period` text;--> statement-breakpoint
ALTER TABLE `contracts` ADD `ambiguity_score` real DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `contracts` ADD `resolution_rule_hash` text;--> statement-breakpoint
ALTER TABLE `contracts` ADD `resolution_status` text DEFAULT 'unclear' NOT NULL;--> statement-breakpoint
ALTER TABLE `forecast_snapshots` ADD `outcome` integer;--> statement-breakpoint
ALTER TABLE `forecast_snapshots` ADD `resolved_at` text;
ALTER TABLE `portfolio_snapshots` ADD `mode` text DEFAULT 'paper' NOT NULL;--> statement-breakpoint
ALTER TABLE `positions` ADD `mode` text DEFAULT 'paper' NOT NULL;
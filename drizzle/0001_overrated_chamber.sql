ALTER TABLE `quotes` ADD `bid_size` real;--> statement-breakpoint
ALTER TABLE `quotes` ADD `ask_size` real;--> statement-breakpoint
ALTER TABLE `research_runs` ADD `evidence_json` text DEFAULT '[]' NOT NULL;

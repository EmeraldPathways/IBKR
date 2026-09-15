ALTER TABLE `agent_decisions` ADD `supporting_evidence_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `agent_decisions` ADD `contradictory_evidence_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `agent_decisions` ADD `what_would_change` text DEFAULT 'New verified evidence or a material quote change.' NOT NULL;--> statement-breakpoint
ALTER TABLE `agent_decisions` ADD `strongest_no_trade_reason` text DEFAULT 'Insufficient verified evidence or failed risk/data gates.' NOT NULL;
CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value_json` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_log_created_idx` ON `audit_log` (`created_at`);--> statement-breakpoint
CREATE TABLE `bridge_heartbeats` (
	`id` text PRIMARY KEY NOT NULL,
	`bridge_id` text NOT NULL,
	`status` text NOT NULL,
	`account_id` text,
	`permissions_json` text DEFAULT '{}' NOT NULL,
	`version` text,
	`observed_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `bridge_heartbeats_observed_idx` ON `bridge_heartbeats` (`bridge_id`,`observed_at`);--> statement-breakpoint
CREATE TABLE `contracts` (
	`id` text PRIMARY KEY NOT NULL,
	`market_group` text NOT NULL,
	`ibkr_conid` integer,
	`provider` text NOT NULL,
	`exchange` text NOT NULL,
	`symbol` text NOT NULL,
	`sec_type` text NOT NULL,
	`trading_class` text,
	`question` text NOT NULL,
	`outcome` text NOT NULL,
	`settlement_value` real DEFAULT 1 NOT NULL,
	`expiration` text NOT NULL,
	`resolution_criteria` text DEFAULT '' NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`tick_size` real DEFAULT 0.01 NOT NULL,
	`minimum_quantity` real DEFAULT 1 NOT NULL,
	`bid` real,
	`ask` real,
	`last_price` real,
	`status` text DEFAULT 'paper_only' NOT NULL,
	`permission_status` text DEFAULT 'unknown' NOT NULL,
	`eligible` integer DEFAULT false NOT NULL,
	`last_trade_at` text,
	`expected_resolution_at` text,
	`expected_payout_at` text,
	`measured_period` text,
	`strike` real,
	`local_symbol` text,
	`data_origin` text DEFAULT 'ibkr_bridge' NOT NULL,
	`raw_json` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `contracts_market_group_idx` ON `contracts` (`market_group`);--> statement-breakpoint
CREATE INDEX `contracts_status_idx` ON `contracts` (`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `contracts_ibkr_conid_outcome_idx` ON `contracts` (`ibkr_conid`,`outcome`);--> statement-breakpoint
CREATE TABLE `fills` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`broker_fill_id` text,
	`quantity` real NOT NULL,
	`price` real NOT NULL,
	`commission` real DEFAULT 0 NOT NULL,
	`filled_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fills_broker_fill_idx` ON `fills` (`broker_fill_id`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`payload_json` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`lease_expiry` text,
	`error_message` text,
	`idempotency_key` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_idempotency_idx` ON `jobs` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `jobs_claim_idx` ON `jobs` (`status`,`type`,`created_at`);--> statement-breakpoint
CREATE TABLE `news_items` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`url` text NOT NULL,
	`source` text NOT NULL,
	`published_at` text NOT NULL,
	`content_hash` text NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`raw_json` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `news_items_hash_idx` ON `news_items` (`content_hash`);--> statement-breakpoint
CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`proposal_id` text,
	`contract_id` text NOT NULL,
	`broker_order_id` text,
	`action` text NOT NULL,
	`quantity` real NOT NULL,
	`limit_price` real NOT NULL,
	`tif` text DEFAULT 'DAY' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`mode` text DEFAULT 'paper' NOT NULL,
	`idempotency_key` text NOT NULL,
	`reject_reason` text,
	`submitted_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orders_idempotency_idx` ON `orders` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `orders_status_idx` ON `orders` (`status`);--> statement-breakpoint
CREATE TABLE `portfolio_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`cash` real NOT NULL,
	`portfolio_value` real NOT NULL,
	`daily_pnl` real NOT NULL,
	`drawdown` real NOT NULL,
	`total_return` real NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `portfolio_snapshots_created_idx` ON `portfolio_snapshots` (`created_at`);--> statement-breakpoint
CREATE TABLE `positions` (
	`id` text PRIMARY KEY NOT NULL,
	`contract_id` text NOT NULL,
	`provider` text NOT NULL,
	`outcome` text NOT NULL,
	`quantity` real DEFAULT 0 NOT NULL,
	`average_entry_price` real DEFAULT 0 NOT NULL,
	`mark_price` real DEFAULT 0 NOT NULL,
	`cost_basis` real DEFAULT 0 NOT NULL,
	`unrealised_pnl` real DEFAULT 0 NOT NULL,
	`realised_pnl` real DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `positions_contract_idx` ON `positions` (`contract_id`);--> statement-breakpoint
CREATE INDEX `positions_status_idx` ON `positions` (`status`);--> statement-breakpoint
CREATE TABLE `probability_estimates` (
	`id` text PRIMARY KEY NOT NULL,
	`contract_id` text NOT NULL,
	`research_run_id` text NOT NULL,
	`estimated_probability` real NOT NULL,
	`confidence` real NOT NULL,
	`net_edge` real,
	`source` text NOT NULL,
	`assumptions_json` text DEFAULT '[]' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `probability_estimates_contract_created_idx` ON `probability_estimates` (`contract_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `proposal_evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`proposal_id` text NOT NULL,
	`title` text NOT NULL,
	`url` text NOT NULL,
	`published_at` text NOT NULL,
	`source` text DEFAULT 'official' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `quotes` (
	`id` text PRIMARY KEY NOT NULL,
	`contract_id` text NOT NULL,
	`bid` real,
	`ask` real,
	`last_price` real,
	`high_bid` real,
	`buy_yes_now_at` real,
	`is_fresh` integer DEFAULT true NOT NULL,
	`observed_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `quotes_contract_observed_idx` ON `quotes` (`contract_id`,`observed_at`);--> statement-breakpoint
CREATE TABLE `research_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`contract_id` text NOT NULL,
	`status` text DEFAULT 'completed' NOT NULL,
	`provider` text DEFAULT 'deterministic' NOT NULL,
	`analyst_probability` real,
	`confidence` real,
	`reasoning_summary` text DEFAULT '' NOT NULL,
	`uncertainties_json` text DEFAULT '[]' NOT NULL,
	`error_message` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `research_runs_contract_created_idx` ON `research_runs` (`contract_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `risk_events` (
	`id` text PRIMARY KEY NOT NULL,
	`event_type` text NOT NULL,
	`severity` text NOT NULL,
	`message` text NOT NULL,
	`details_json` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `risk_events_created_idx` ON `risk_events` (`created_at`);--> statement-breakpoint
CREATE TABLE `trade_proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`contract_id` text NOT NULL,
	`outcome` text NOT NULL,
	`direction` text NOT NULL,
	`current_quote` real NOT NULL,
	`estimated_probability` real NOT NULL,
	`gross_edge` real NOT NULL,
	`net_edge` real NOT NULL,
	`max_entry_price` real NOT NULL,
	`quantity` real NOT NULL,
	`notional_value` real NOT NULL,
	`confidence` real NOT NULL,
	`evidence_json` text DEFAULT '[]' NOT NULL,
	`risk_check_results_json` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`expires_at` text NOT NULL,
	`mode` text DEFAULT 'paper' NOT NULL,
	`approved_at` text,
	`rejected_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `trade_proposals_status_created_idx` ON `trade_proposals` (`status`,`created_at`);
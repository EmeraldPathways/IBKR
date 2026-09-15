CREATE TABLE `agent_decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`decision` text NOT NULL,
	`rationale` text NOT NULL,
	`evidence_json` text DEFAULT '[]' NOT NULL,
	`requires_approval` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `agent_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`role` text NOT NULL,
	`model` text NOT NULL,
	`task_type` text NOT NULL,
	`contract_id` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`input_json` text DEFAULT '{}' NOT NULL,
	`output_json` text,
	`error_message` text,
	`started_at` text,
	`completed_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `agent_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`task_type` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`result_json` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `data_quality_events` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text,
	`contract_id` text,
	`severity` text NOT NULL,
	`event_type` text NOT NULL,
	`message` text NOT NULL,
	`details_json` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `data_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`endpoint` text,
	`reliability` real DEFAULT 0.5 NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`last_success_at` text,
	`last_error` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `forecast_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`contract_id` text NOT NULL,
	`estimated_probability` real NOT NULL,
	`confidence` real NOT NULL,
	`market_probability` real,
	`net_edge` real,
	`agent_run_id` text,
	`observed_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ingestion_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`records_fetched` integer DEFAULT 0 NOT NULL,
	`records_accepted` integer DEFAULT 0 NOT NULL,
	`records_rejected` integer DEFAULT 0 NOT NULL,
	`error_message` text,
	`started_at` text NOT NULL,
	`completed_at` text
);
--> statement-breakpoint
CREATE TABLE `market_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`contract_id` text NOT NULL,
	`yes_bid` real,
	`yes_ask` real,
	`no_bid` real,
	`no_ask` real,
	`available_size` real,
	`source` text NOT NULL,
	`observed_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `resolution_observations` (
	`id` text PRIMARY KEY NOT NULL,
	`contract_id` text NOT NULL,
	`source_id` text NOT NULL,
	`observation_type` text NOT NULL,
	`value_json` text NOT NULL,
	`source_url` text,
	`observed_at` text NOT NULL,
	`confidence` real DEFAULT 0.5 NOT NULL
);

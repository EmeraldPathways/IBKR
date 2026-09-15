CREATE TABLE IF NOT EXISTS `contract_versions` (
  `id` text PRIMARY KEY NOT NULL,
  `contract_id` text NOT NULL,
  `version_hash` text NOT NULL,
  `question` text NOT NULL,
  `resolution_criteria` text NOT NULL,
  `resolution_source_url` text,
  `changed_fields_json` text NOT NULL DEFAULT '[]',
  `observed_at` text NOT NULL,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `contract_versions_contract_idx` ON `contract_versions` (`contract_id`, `observed_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `decision_attributions` (
  `id` text PRIMARY KEY NOT NULL,
  `proposal_id` text,
  `order_id` text,
  `forecast_id` text,
  `arrival_price` real,
  `approval_price` real,
  `submission_price` real,
  `fill_price` real,
  `realized_edge` real,
  `timing_contribution` real,
  `sizing_contribution` real,
  `forecast_contribution` real,
  `payload_json` text NOT NULL DEFAULT '{}',
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `decision_attributions_order_idx` ON `decision_attributions` (`order_id`, `created_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `correlation_edges` (
  `id` text PRIMARY KEY NOT NULL,
  `source_contract_id` text NOT NULL,
  `target_contract_id` text NOT NULL,
  `relationship` text NOT NULL,
  `confidence` real NOT NULL DEFAULT 0,
  `source` text NOT NULL,
  `cap` real,
  `verified_at` text
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `benchmark_events` (
  `id` text PRIMARY KEY NOT NULL,
  `event_type` text NOT NULL,
  `entity_id` text,
  `payload_json` text NOT NULL,
  `previous_hash` text NOT NULL,
  `event_hash` text NOT NULL,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `benchmark_events_hash_idx` ON `benchmark_events` (`event_hash`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `model_registry` (
  `id` text PRIMARY KEY NOT NULL,
  `role` text NOT NULL,
  `model` text NOT NULL,
  `prompt_hash` text,
  `status` text NOT NULL DEFAULT 'active',
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `event_alerts` (
  `id` text PRIMARY KEY NOT NULL,
  `rule` text NOT NULL,
  `severity` text NOT NULL,
  `entity_id` text,
  `message` text NOT NULL,
  `acknowledged` integer NOT NULL DEFAULT 0,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);

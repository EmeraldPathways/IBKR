CREATE TABLE IF NOT EXISTS `helper_messages` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `owner_id` text NOT NULL,
  `role` text NOT NULL,
  `message` text NOT NULL,
  `model` text NOT NULL,
  `view` text,
  `program` text,
  `created_at` text NOT NULL,
  CONSTRAINT `helper_messages_role_check` CHECK (`role` IN ('user', 'assistant'))
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `helper_messages_owner_created_idx` ON `helper_messages` (`owner_id`, `created_at`);

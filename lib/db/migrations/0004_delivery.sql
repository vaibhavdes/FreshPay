ALTER TABLE `contracts` ADD `balance_order_id` text;--> statement-breakpoint
ALTER TABLE `contracts` ADD `balance_authorization_id` text;--> statement-breakpoint
ALTER TABLE `contracts` ADD `balance_authorized_cents` integer;--> statement-breakpoint
ALTER TABLE `contracts` ADD `balance_capture_id` text;--> statement-breakpoint
ALTER TABLE `contracts` ADD `balance_captured_cents` integer;--> statement-breakpoint
ALTER TABLE `contracts` ADD `delivered_kg` integer;--> statement-breakpoint
ALTER TABLE `contracts` ADD `accepted_kg` integer;--> statement-breakpoint
ALTER TABLE `contracts` ADD `quality_percent` integer;--> statement-breakpoint
ALTER TABLE `contracts` ADD `carrier` text;--> statement-breakpoint
ALTER TABLE `contracts` ADD `tracking_number` text;--> statement-breakpoint
ALTER TABLE `plots` ADD `value_cents` integer DEFAULT 0 NOT NULL;
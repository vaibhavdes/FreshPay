CREATE TABLE `buyers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`country` text NOT NULL,
	`paypal_email` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`plot_id` text NOT NULL,
	`milestone_type` text NOT NULL,
	`code` text NOT NULL,
	`issued_at` integer NOT NULL,
	`used_at` integer,
	FOREIGN KEY (`plot_id`) REFERENCES `plots`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `contracts` (
	`id` text PRIMARY KEY NOT NULL,
	`buyer_id` text NOT NULL,
	`cooperative_id` text NOT NULL,
	`commodity` text NOT NULL,
	`season` text NOT NULL,
	`currency` text NOT NULL,
	`total_cents` integer NOT NULL,
	`advance_cents` integer NOT NULL,
	`escrow_remaining_cents` integer DEFAULT 0 NOT NULL,
	`state` text NOT NULL,
	`advance_order_id` text,
	`advance_capture_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`buyer_id`) REFERENCES `buyers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`cooperative_id`) REFERENCES `cooperatives`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `cooperatives` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`region` text NOT NULL,
	`country` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `eudr_records` (
	`id` text PRIMARY KEY NOT NULL,
	`plot_id` text NOT NULL,
	`record` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`plot_id`) REFERENCES `plots`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`milestone_id` text NOT NULL,
	`challenge_id` text,
	`kind` text NOT NULL,
	`sha256` text NOT NULL,
	`gps` text,
	`oracle` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`milestone_id`) REFERENCES `milestones`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`challenge_id`) REFERENCES `challenges`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `farmers` (
	`id` text PRIMARY KEY NOT NULL,
	`cooperative_id` text NOT NULL,
	`name` text NOT NULL,
	`paypal_email` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`cooperative_id`) REFERENCES `cooperatives`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `input_dealers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`paypal_email` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ledger_receipts` (
	`seq` integer PRIMARY KEY NOT NULL,
	`prev_hash` text NOT NULL,
	`hash` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ledger_receipts_hash_unique` ON `ledger_receipts` (`hash`);--> statement-breakpoint
CREATE TABLE `mandates` (
	`id` text PRIMARY KEY NOT NULL,
	`contract_id` text NOT NULL,
	`vault_token_id` text,
	`cap_cents` integer NOT NULL,
	`used_cents` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`contract_id`) REFERENCES `contracts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `milestones` (
	`id` text PRIMARY KEY NOT NULL,
	`contract_id` text NOT NULL,
	`plot_id` text NOT NULL,
	`type` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`state` text NOT NULL,
	`opens_at` integer NOT NULL,
	`closes_at` integer NOT NULL,
	`tranche_cents` integer NOT NULL,
	`premium_cents` integer DEFAULT 0 NOT NULL,
	`shares` text NOT NULL,
	`decision` text,
	`decided_at` integer,
	FOREIGN KEY (`contract_id`) REFERENCES `contracts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`plot_id`) REFERENCES `plots`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `milestones_plot_type` ON `milestones` (`contract_id`,`plot_id`,`type`);--> statement-breakpoint
CREATE TABLE `payout_items` (
	`id` text PRIMARY KEY NOT NULL,
	`op_id` text NOT NULL,
	`payee_id` text NOT NULL,
	`receiver` text NOT NULL,
	`cents` integer NOT NULL,
	`payout_item_id` text,
	`status` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`op_id`) REFERENCES `paypal_ops`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `payout_items_paypal_id` ON `payout_items` (`payout_item_id`);--> statement-breakpoint
CREATE TABLE `paypal_ops` (
	`id` text PRIMARY KEY NOT NULL,
	`op` text NOT NULL,
	`key` text NOT NULL,
	`request_id` text NOT NULL,
	`status` text NOT NULL,
	`paypal_id` text,
	`debug_id` text,
	`error_route` text,
	`error_issue` text,
	`learned_from` text,
	`sync_ms` integer,
	`webhook_ms` integer,
	`attempts` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `paypal_ops_key` ON `paypal_ops` (`key`);--> statement-breakpoint
CREATE INDEX `paypal_ops_paypal_id` ON `paypal_ops` (`paypal_id`);--> statement-breakpoint
CREATE TABLE `plots` (
	`id` text PRIMARY KEY NOT NULL,
	`farmer_id` text NOT NULL,
	`dealer_id` text,
	`name` text NOT NULL,
	`country` text NOT NULL,
	`commodity` text NOT NULL,
	`ring` text NOT NULL,
	`area_ha` real NOT NULL,
	`eudr_status` text NOT NULL,
	`eudr_check` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`farmer_id`) REFERENCES `farmers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`dealer_id`) REFERENCES `input_dealers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `webhook_events` (
	`id` text PRIMARY KEY NOT NULL,
	`event_type` text NOT NULL,
	`resource_id` text,
	`replay_count` integer DEFAULT 0 NOT NULL,
	`payload` text NOT NULL,
	`received_at` integer NOT NULL
);

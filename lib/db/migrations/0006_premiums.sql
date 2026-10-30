CREATE TABLE `premiums` (
	`id` text PRIMARY KEY NOT NULL,
	`contract_id` text NOT NULL,
	`plot_id` text NOT NULL,
	`farmer_id` text NOT NULL,
	`cents` integer NOT NULL,
	`state` text NOT NULL,
	`order_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`contract_id`) REFERENCES `contracts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`plot_id`) REFERENCES `plots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`farmer_id`) REFERENCES `farmers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `premiums_plot` ON `premiums` (`contract_id`,`plot_id`);--> statement-breakpoint
ALTER TABLE `mandates` ADD `setup_token_id` text;--> statement-breakpoint
ALTER TABLE `mandates` ADD `vault_status` text DEFAULT 'NONE' NOT NULL;--> statement-breakpoint
ALTER TABLE `mandates` ADD `per_plot_cents` integer DEFAULT 0 NOT NULL;
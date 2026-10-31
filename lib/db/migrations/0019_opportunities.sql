CREATE TABLE `opportunities` (
	`id` text PRIMARY KEY NOT NULL,
	`contract_id` text NOT NULL,
	`title` text NOT NULL,
	`template_id` text NOT NULL,
	`country` text NOT NULL,
	`region` text NOT NULL,
	`hectares_wanted` real NOT NULL,
	`apply_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`contract_id`) REFERENCES `contracts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `opportunities_contract_id_unique` ON `opportunities` (`contract_id`);--> statement-breakpoint
ALTER TABLE `contracts` ADD `terms` text;--> statement-breakpoint
ALTER TABLE `milestones` ADD `label` text;
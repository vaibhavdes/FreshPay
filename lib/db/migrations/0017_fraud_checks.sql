CREATE TABLE `bill_fingerprints` (
	`contract_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`milestone_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`contract_id`) REFERENCES `contracts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`milestone_id`) REFERENCES `milestones`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bill_fingerprints_contract` ON `bill_fingerprints` (`contract_id`,`fingerprint`);--> statement-breakpoint
ALTER TABLE `evidence` ADD `photo_hash` text;
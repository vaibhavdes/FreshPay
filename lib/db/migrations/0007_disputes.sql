CREATE TABLE `disputes` (
	`id` text PRIMARY KEY NOT NULL,
	`contract_id` text,
	`transaction_id` text,
	`reason` text NOT NULL,
	`status` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`response_due_at` text,
	`narrative` text,
	`narrative_model` text,
	`evidence_sent_at` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`contract_id`) REFERENCES `contracts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `disputes_contract` ON `disputes` (`contract_id`);
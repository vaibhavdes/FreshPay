CREATE TABLE `bill_confirmations` (
	`id` text PRIMARY KEY NOT NULL,
	`milestone_id` text NOT NULL,
	`payee_id` text NOT NULL,
	`cents` integer NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`decided_at` integer,
	FOREIGN KEY (`milestone_id`) REFERENCES `milestones`(`id`) ON UPDATE no action ON DELETE no action
);

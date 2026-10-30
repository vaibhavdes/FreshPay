CREATE TABLE `agent_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`milestone_id` text NOT NULL,
	`model` text NOT NULL,
	`recommendation` text NOT NULL,
	`confidence` text NOT NULL,
	`summary` text NOT NULL,
	`reasons` text NOT NULL,
	`checks` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`milestone_id`) REFERENCES `milestones`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `agent_reviews_milestone` ON `agent_reviews` (`milestone_id`);
ALTER TABLE `input_dealers` ADD `kind` text DEFAULT 'INPUTS' NOT NULL;--> statement-breakpoint
ALTER TABLE `milestones` ADD `payee_id` text;
CREATE TABLE `reconciliation_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`window_start` integer NOT NULL,
	`window_end` integer NOT NULL,
	`result` text NOT NULL,
	`created_at` integer NOT NULL
);

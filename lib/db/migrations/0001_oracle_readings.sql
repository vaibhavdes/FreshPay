CREATE TABLE `oracle_readings` (
	`input_hash` text PRIMARY KEY NOT NULL,
	`model` text NOT NULL,
	`reading` text NOT NULL,
	`created_at` integer NOT NULL
);

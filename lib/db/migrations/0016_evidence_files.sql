CREATE TABLE `evidence_files` (
	`sha256` text PRIMARY KEY NOT NULL,
	`content_type` text NOT NULL,
	`bytes` blob NOT NULL,
	`created_at` integer NOT NULL
);

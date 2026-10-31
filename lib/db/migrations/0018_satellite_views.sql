CREATE TABLE `satellite_views` (
	`ring_key` text NOT NULL,
	`month` text NOT NULL,
	`ndvi` real,
	`clear_share` real NOT NULL,
	`picture` blob,
	`fetched_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `satellite_views_month` ON `satellite_views` (`ring_key`,`month`);
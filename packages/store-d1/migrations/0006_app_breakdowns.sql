CREATE TABLE `app_breakdowns_daily` (
	`app_id` text NOT NULL,
	`store` text NOT NULL,
	`date` text NOT NULL,
	`dimension` text NOT NULL,
	`value` text NOT NULL,
	`installs` integer,
	`deletions` integer,
	`active_devices` integer,
	`crashes` integer,
	`anrs` integer,
	`daily_rating` real,
	`total_rating` real,
	`sessions` integer,
	`session_seconds` integer,
	`session_devices` integer,
	PRIMARY KEY(`app_id`, `store`, `date`, `dimension`, `value`)
);
--> statement-breakpoint
CREATE INDEX `app_breakdowns_daily_date` ON `app_breakdowns_daily` (`app_id`,`dimension`,`date`);
CREATE TABLE `app_framework_daily` (
	`app_id` text NOT NULL,
	`report` text NOT NULL,
	`date` text NOT NULL,
	`dims` text NOT NULL,
	`metrics` text NOT NULL,
	PRIMARY KEY(`app_id`, `report`, `date`, `dims`)
);
--> statement-breakpoint
CREATE INDEX `app_framework_daily_date` ON `app_framework_daily` (`app_id`,`report`,`date`);--> statement-breakpoint
ALTER TABLE `app_configs` ADD `framework_reports` text;
CREATE TABLE `app_store_pages_daily` (
	`app_id` text NOT NULL,
	`date` text NOT NULL,
	`level` text NOT NULL,
	`page_type` text NOT NULL,
	`page_title` text DEFAULT '' NOT NULL,
	`impressions` integer DEFAULT 0 NOT NULL,
	`impressions_unique` integer DEFAULT 0 NOT NULL,
	`page_views` integer DEFAULT 0 NOT NULL,
	`page_views_unique` integer DEFAULT 0 NOT NULL,
	`downloads` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`app_id`, `date`, `level`, `page_type`, `page_title`)
);
--> statement-breakpoint
CREATE INDEX `app_store_pages_daily_date` ON `app_store_pages_daily` (`app_id`,`level`,`date`);
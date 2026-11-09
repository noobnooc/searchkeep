CREATE TABLE `app_chart_ranks` (
	`app_id` text NOT NULL,
	`date` text NOT NULL,
	`territory` text NOT NULL,
	`chart` text NOT NULL,
	`genre` text NOT NULL,
	`rank` integer,
	PRIMARY KEY(`app_id`, `date`, `territory`, `chart`, `genre`)
);
--> statement-breakpoint
CREATE TABLE `app_configs` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`apple_id` text,
	`play_package` text,
	`site_id` text,
	`territories` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `app_ratings` (
	`app_id` text NOT NULL,
	`store` text NOT NULL,
	`date` text NOT NULL,
	`territory` text NOT NULL,
	`average` real,
	`count` integer,
	`daily_average` real,
	PRIMARY KEY(`app_id`, `store`, `date`, `territory`)
);
--> statement-breakpoint
CREATE TABLE `app_referrers` (
	`app_id` text NOT NULL,
	`store` text NOT NULL,
	`date` text NOT NULL,
	`kind` text NOT NULL,
	`referrer` text NOT NULL,
	`page_views` integer DEFAULT 0 NOT NULL,
	`downloads` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`app_id`, `store`, `date`, `kind`, `referrer`)
);
--> statement-breakpoint
CREATE TABLE `app_reviews` (
	`app_id` text NOT NULL,
	`store` text NOT NULL,
	`id` text NOT NULL,
	`created_at` text NOT NULL,
	`date` text NOT NULL,
	`rating` integer NOT NULL,
	`title` text,
	`body` text,
	`territory` text,
	`language` text,
	`version` text,
	`replied` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`app_id`, `store`, `id`)
);
--> statement-breakpoint
CREATE INDEX `app_reviews_date` ON `app_reviews` (`app_id`,`date`);--> statement-breakpoint
CREATE TABLE `app_search_terms` (
	`app_id` text NOT NULL,
	`date` text NOT NULL,
	`term` text NOT NULL,
	`visitors` integer DEFAULT 0 NOT NULL,
	`acquisitions` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`app_id`, `date`, `term`)
);
--> statement-breakpoint
CREATE TABLE `app_store_daily` (
	`app_id` text NOT NULL,
	`store` text NOT NULL,
	`date` text NOT NULL,
	`territory` text NOT NULL,
	`source` text NOT NULL,
	`impressions` integer DEFAULT 0 NOT NULL,
	`impressions_unique` integer DEFAULT 0 NOT NULL,
	`page_views` integer DEFAULT 0 NOT NULL,
	`page_views_unique` integer DEFAULT 0 NOT NULL,
	`downloads` integer DEFAULT 0 NOT NULL,
	`redownloads` integer DEFAULT 0 NOT NULL,
	`installs` integer DEFAULT 0 NOT NULL,
	`deletions` integer DEFAULT 0 NOT NULL,
	`active_devices` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`app_id`, `store`, `date`, `territory`, `source`)
);
--> statement-breakpoint
CREATE INDEX `app_store_daily_date` ON `app_store_daily` (`app_id`,`date`);--> statement-breakpoint
CREATE TABLE `app_vitals` (
	`app_id` text NOT NULL,
	`store` text NOT NULL,
	`date` text NOT NULL,
	`version` text NOT NULL,
	`crash_rate` real,
	`user_perceived_crash_rate` real,
	`anr_rate` real,
	`user_perceived_anr_rate` real,
	`distinct_users` integer,
	`crashes` integer,
	`crash_devices` integer,
	PRIMARY KEY(`app_id`, `store`, `date`, `version`)
);

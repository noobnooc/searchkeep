CREATE TABLE `app_ads_share_daily` (
	`app_id` text NOT NULL,
	`date` text NOT NULL,
	`territory` text NOT NULL,
	`term` text NOT NULL,
	`low_share` real,
	`high_share` real,
	`rank` integer,
	`popularity` integer,
	PRIMARY KEY(`app_id`, `date`, `territory`, `term`)
);
--> statement-breakpoint
CREATE INDEX `app_ads_share_daily_date` ON `app_ads_share_daily` (`app_id`,`date`);--> statement-breakpoint
CREATE TABLE `app_ads_terms_daily` (
	`app_id` text NOT NULL,
	`date` text NOT NULL,
	`campaign_id` text NOT NULL,
	`term` text NOT NULL,
	`keyword` text DEFAULT '' NOT NULL,
	`impressions` integer DEFAULT 0 NOT NULL,
	`taps` integer DEFAULT 0 NOT NULL,
	`installs` integer DEFAULT 0 NOT NULL,
	`new_downloads` integer DEFAULT 0 NOT NULL,
	`spend_cents` integer DEFAULT 0 NOT NULL,
	`currency` text DEFAULT '' NOT NULL,
	PRIMARY KEY(`app_id`, `date`, `campaign_id`, `term`, `keyword`)
);
--> statement-breakpoint
CREATE INDEX `app_ads_terms_daily_date` ON `app_ads_terms_daily` (`app_id`,`date`);
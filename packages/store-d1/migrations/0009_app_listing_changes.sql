CREATE TABLE `app_listing_changes` (
	`app_id` text NOT NULL,
	`store` text NOT NULL,
	`date` text NOT NULL,
	`entity` text NOT NULL,
	`locale` text DEFAULT '' NOT NULL,
	`field` text NOT NULL,
	`before` text,
	`after` text,
	PRIMARY KEY(`app_id`, `store`, `date`, `entity`, `locale`, `field`)
);
--> statement-breakpoint
CREATE INDEX `app_listing_changes_date` ON `app_listing_changes` (`app_id`,`date`);--> statement-breakpoint
CREATE TABLE `app_listing_values` (
	`app_id` text NOT NULL,
	`store` text NOT NULL,
	`entity` text NOT NULL,
	`locale` text DEFAULT '' NOT NULL,
	`field` text NOT NULL,
	`value` text NOT NULL,
	`seen_on` text NOT NULL,
	PRIMARY KEY(`app_id`, `store`, `entity`, `locale`, `field`)
);

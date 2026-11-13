CREATE TABLE `app_subscription_metrics_daily` (
	`app_id` text NOT NULL,
	`store` text NOT NULL,
	`kind` text NOT NULL,
	`date` text NOT NULL,
	`metric` text NOT NULL,
	`metric_group` text DEFAULT '' NOT NULL,
	`product` text NOT NULL,
	`offer_type` text DEFAULT '' NOT NULL,
	`territory` text NOT NULL,
	`source` text NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`app_id`, `store`, `kind`, `date`, `metric`, `metric_group`, `product`, `offer_type`, `territory`, `source`)
);
--> statement-breakpoint
CREATE INDEX `app_subscription_metrics_daily_date` ON `app_subscription_metrics_daily` (`app_id`,`kind`,`date`);
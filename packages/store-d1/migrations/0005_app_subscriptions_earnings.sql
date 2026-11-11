CREATE TABLE `app_earnings` (
	`app_id` text NOT NULL,
	`file` text NOT NULL,
	`date` text NOT NULL,
	`territory` text NOT NULL,
	`purchases` integer DEFAULT 0 NOT NULL,
	`proceeds_cents` integer DEFAULT 0 NOT NULL,
	`sales_cents` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`app_id`, `file`, `date`, `territory`)
);
--> statement-breakpoint
CREATE INDEX `app_earnings_date` ON `app_earnings` (`app_id`,`date`);--> statement-breakpoint
CREATE TABLE `app_subscriptions_daily` (
	`app_id` text NOT NULL,
	`date` text NOT NULL,
	`territory` text NOT NULL,
	`product` text NOT NULL,
	`base_plan` text DEFAULT '' NOT NULL,
	`new_subscriptions` integer DEFAULT 0 NOT NULL,
	`canceled_subscriptions` integer DEFAULT 0 NOT NULL,
	`active_subscriptions` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`app_id`, `date`, `territory`, `product`, `base_plan`)
);

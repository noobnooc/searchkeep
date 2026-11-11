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

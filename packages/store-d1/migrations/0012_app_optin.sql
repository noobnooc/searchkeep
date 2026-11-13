CREATE TABLE `app_optin_daily` (
	`app_id` text NOT NULL,
	`date` text NOT NULL,
	`downloading_users` integer DEFAULT 0 NOT NULL,
	`opting_in_users` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`app_id`, `date`)
);

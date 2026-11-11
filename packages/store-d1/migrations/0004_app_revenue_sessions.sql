ALTER TABLE `app_store_daily` ADD `purchases` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `app_store_daily` ADD `proceeds_cents` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `app_store_daily` ADD `sales_cents` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `app_store_daily` ADD `paying_users` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `app_store_daily` ADD `sessions` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `app_store_daily` ADD `session_seconds` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `app_store_daily` ADD `session_devices` integer DEFAULT 0 NOT NULL;
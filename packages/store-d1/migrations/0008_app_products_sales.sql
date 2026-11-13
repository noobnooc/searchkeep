CREATE TABLE `app_products_daily` (
	`app_id` text NOT NULL,
	`store` text NOT NULL,
	`date` text NOT NULL,
	`product` text NOT NULL,
	`purchase_type` text DEFAULT '' NOT NULL,
	`territory` text NOT NULL,
	`purchases` integer DEFAULT 0 NOT NULL,
	`refunds` integer DEFAULT 0 NOT NULL,
	`proceeds_cents` integer DEFAULT 0 NOT NULL,
	`refund_proceeds_cents` integer DEFAULT 0 NOT NULL,
	`sales_cents` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`app_id`, `store`, `date`, `product`, `purchase_type`, `territory`)
);
--> statement-breakpoint
CREATE INDEX `app_products_daily_date` ON `app_products_daily` (`app_id`,`date`);--> statement-breakpoint
CREATE TABLE `app_sales_daily` (
	`app_id` text NOT NULL,
	`date` text NOT NULL,
	`sku` text NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`product_type` text NOT NULL,
	`subscription` text DEFAULT '' NOT NULL,
	`period` text DEFAULT '' NOT NULL,
	`territory` text NOT NULL,
	`proceeds_currency` text NOT NULL,
	`customer_currency` text NOT NULL,
	`customer_price_cents` integer DEFAULT 0 NOT NULL,
	`units` integer DEFAULT 0 NOT NULL,
	`refund_units` integer DEFAULT 0 NOT NULL,
	`proceeds_cents` integer DEFAULT 0 NOT NULL,
	`refund_proceeds_cents` integer DEFAULT 0 NOT NULL,
	`sales_cents` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`app_id`, `date`, `sku`, `product_type`, `subscription`, `period`, `territory`, `proceeds_currency`, `customer_currency`, `customer_price_cents`)
);
--> statement-breakpoint
CREATE INDEX `app_sales_daily_date` ON `app_sales_daily` (`app_id`,`date`);
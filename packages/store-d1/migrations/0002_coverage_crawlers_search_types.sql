CREATE TABLE `index_status` (
	`site_id` text NOT NULL,
	`url` text NOT NULL,
	`first_seen` text NOT NULL,
	`inspected_at` text,
	`verdict` text,
	`coverage_state` text,
	`indexing_state` text,
	`page_fetch_state` text,
	`robots_txt_state` text,
	`last_crawl_time` text,
	`google_canonical` text,
	`user_canonical` text,
	`crawled_as` text,
	`rich_results_verdict` text,
	`rich_results` text,
	`error` text,
	`previous_coverage_state` text,
	`changed_at` text,
	PRIMARY KEY(`site_id`, `url`)
);
--> statement-breakpoint
CREATE INDEX `index_status_inspected` ON `index_status` (`site_id`,`inspected_at`);--> statement-breakpoint
CREATE TABLE `search_appearances` (
	`site_id` text NOT NULL,
	`source` text NOT NULL,
	`date` text NOT NULL,
	`appearance` text NOT NULL,
	`clicks` integer NOT NULL,
	`impressions` integer NOT NULL,
	`position_sum` real,
	PRIMARY KEY(`site_id`, `source`, `date`, `appearance`)
);
--> statement-breakpoint
CREATE TABLE `search_crawler_requests` (
	`site_id` text NOT NULL,
	`date` text NOT NULL,
	`crawler` text NOT NULL,
	`operator` text NOT NULL,
	`purpose` text NOT NULL,
	`page_id` integer NOT NULL,
	`status` integer NOT NULL,
	`requests` integer NOT NULL,
	PRIMARY KEY(`site_id`, `date`, `crawler`, `page_id`, `status`)
);
--> statement-breakpoint
CREATE INDEX `search_crawler_page` ON `search_crawler_requests` (`site_id`,`page_id`);--> statement-breakpoint
CREATE TABLE `search_segments` (
	`site_id` text NOT NULL,
	`source` text NOT NULL,
	`kind` text NOT NULL,
	`date` text NOT NULL,
	`item_id` integer NOT NULL,
	`country` text NOT NULL,
	`device` text NOT NULL,
	`clicks` integer NOT NULL,
	`impressions` integer NOT NULL,
	`position_sum` real,
	PRIMARY KEY(`site_id`, `source`, `kind`, `date`, `item_id`, `country`, `device`)
);
--> statement-breakpoint
CREATE INDEX `search_segments_item` ON `search_segments` (`site_id`,`source`,`kind`,`item_id`);
CREATE TABLE `ai_citations` (
	`site_id` text NOT NULL,
	`date` text NOT NULL,
	`page_id` integer NOT NULL,
	`surface` text NOT NULL,
	`citations` integer NOT NULL,
	PRIMARY KEY(`site_id`, `date`, `page_id`, `surface`)
);
--> statement-breakpoint
CREATE TABLE `ai_crawler_requests` (
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
CREATE INDEX `ai_crawler_page` ON `ai_crawler_requests` (`site_id`,`page_id`);--> statement-breakpoint
CREATE TABLE `crawl_issues` (
	`site_id` text NOT NULL,
	`source` text NOT NULL,
	`url` text NOT NULL,
	`issue` text NOT NULL,
	`http_code` integer,
	`detected_at` text,
	PRIMARY KEY(`site_id`, `source`, `url`, `issue`)
);
--> statement-breakpoint
CREATE TABLE `meta` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `pages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`site_id` text NOT NULL,
	`path` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pages_site_path` ON `pages` (`site_id`,`path`);--> statement-breakpoint
CREATE TABLE `queries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`site_id` text NOT NULL,
	`text` text NOT NULL,
	`is_brand` integer DEFAULT 0 NOT NULL,
	`brand_version` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `queries_site_text` ON `queries` (`site_id`,`text`);--> statement-breakpoint
CREATE INDEX `queries_site_version` ON `queries` (`site_id`,`brand_version`);--> statement-breakpoint
CREATE TABLE `search_breakdowns` (
	`site_id` text NOT NULL,
	`source` text NOT NULL,
	`date` text NOT NULL,
	`country` text NOT NULL,
	`device` text NOT NULL,
	`clicks` integer NOT NULL,
	`impressions` integer NOT NULL,
	`position_sum` real,
	PRIMARY KEY(`site_id`, `source`, `date`, `country`, `device`)
);
--> statement-breakpoint
CREATE TABLE `search_facts` (
	`site_id` text NOT NULL,
	`source` text NOT NULL,
	`kind` text NOT NULL,
	`date` text NOT NULL,
	`page_id` integer DEFAULT 0 NOT NULL,
	`query_id` integer DEFAULT 0 NOT NULL,
	`clicks` integer NOT NULL,
	`impressions` integer NOT NULL,
	`position_sum` real,
	PRIMARY KEY(`site_id`, `source`, `kind`, `date`, `page_id`, `query_id`)
);
--> statement-breakpoint
CREATE INDEX `search_facts_page` ON `search_facts` (`site_id`,`source`,`page_id`);--> statement-breakpoint
CREATE INDEX `search_facts_query` ON `search_facts` (`site_id`,`source`,`query_id`);--> statement-breakpoint
CREATE TABLE `sitemaps` (
	`site_id` text NOT NULL,
	`source` text NOT NULL,
	`path` text NOT NULL,
	`last_submitted` text,
	`last_downloaded` text,
	`is_pending` integer DEFAULT 0 NOT NULL,
	`errors` integer DEFAULT 0 NOT NULL,
	`warnings` integer DEFAULT 0 NOT NULL,
	`submitted` integer,
	`indexed` integer,
	PRIMARY KEY(`site_id`, `source`, `path`)
);
--> statement-breakpoint
CREATE TABLE `sites` (
	`id` text PRIMARY KEY NOT NULL,
	`domain` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sync_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`trigger` text NOT NULL,
	`status` text NOT NULL,
	`rows_written` integer DEFAULT 0 NOT NULL,
	`message` text,
	`details` text
);
--> statement-breakpoint
CREATE INDEX `sync_runs_started` ON `sync_runs` (`started_at`);--> statement-breakpoint
CREATE TABLE `web_analytics` (
	`site_id` text NOT NULL,
	`date` text NOT NULL,
	`page_id` integer NOT NULL,
	`referer_host` text NOT NULL,
	`visits` integer NOT NULL,
	`page_views` integer NOT NULL,
	PRIMARY KEY(`site_id`, `date`, `page_id`, `referer_host`)
);
--> statement-breakpoint
CREATE INDEX `web_analytics_referer` ON `web_analytics` (`site_id`,`referer_host`,`date`);--> statement-breakpoint
CREATE TABLE `web_vitals` (
	`site_id` text NOT NULL,
	`date` text NOT NULL,
	`page_id` integer NOT NULL,
	`lcp_p75` real,
	`inp_p75` real,
	`cls_p75` real,
	`samples` integer NOT NULL,
	PRIMARY KEY(`site_id`, `date`, `page_id`)
);

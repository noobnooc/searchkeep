CREATE TABLE `site_configs` (
	`id` text PRIMARY KEY NOT NULL,
	`domain` text NOT NULL,
	`gsc_property` text,
	`bing_site_url` text,
	`cloudflare_zone_id` text,
	`web_analytics_site_tag` text,
	`brand_regex` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);

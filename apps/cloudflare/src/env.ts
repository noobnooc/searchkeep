/** Bindings and secrets. Every secret is optional so a half-configured deployment still boots (and reports what is missing). */
export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  /** Cloudflare Browser Run: Bing's API refuses Workers' egress IPs but accepts Browser Run's. */
  BROWSER?: Fetcher;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_API_TOKEN?: string;
  SITES?: string;
  GSC_CLIENT_EMAIL?: string;
  GSC_PRIVATE_KEY?: string;
  BING_API_KEY?: string;
  BRAND_REGEX?: string;
  ENABLE_WRITES?: string;
  GSC_ROWS_PER_DAY?: string;
  GSC_BACKFILL_MONTHS?: string;
  SYNC_DAILY_WRITE_BUDGET?: string;
  SYNC_MAX_CALLS_PER_RUN?: string;
  /** Apps (ADR 0009): optional JSON array; apps can also be added in the dashboard. */
  APPS?: string;
  /** App Store Connect API key with the Sales and Reports role. */
  ASC_KEY_ID?: string;
  ASC_ISSUER_ID?: string;
  ASC_PRIVATE_KEY?: string;
  ASC_VENDOR_NUMBER?: string;
  PLAY_METADATA?: string;
  PLAY_REVIEWS_API?: string;
  APPLE_ADS_CLIENT_ID?: string;
  APPLE_ADS_TEAM_ID?: string;
  APPLE_ADS_KEY_ID?: string;
  APPLE_ADS_PRIVATE_KEY?: string;
  APPLE_ADS_ACCOUNT_ID?: string;
  ASC_REPLY_KEY_ID?: string;
  ASC_REPLY_PRIVATE_KEY?: string;
  /** Google Play: Cloud Storage bucket of the Play Console reports; the service account defaults to GSC's. */
  PLAY_REPORTS_BUCKET?: string;
  PLAY_CLIENT_EMAIL?: string;
  PLAY_PRIVATE_KEY?: string;
  /** Opt-in plugin: Apple's public App Store feeds (own app's rating and chart position). */
  APP_STORE_PUBLIC_DATA?: string;
  /** Local development only: honoured exclusively for requests to localhost. */
  SEARCHKEEP_DEV?: string;
}

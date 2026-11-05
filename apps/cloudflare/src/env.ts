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
  /** Local development only: honoured exclusively for requests to localhost. */
  SEARCHKEEP_DEV?: string;
}

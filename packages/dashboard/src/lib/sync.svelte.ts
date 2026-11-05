/**
 * Watches the sync progress (`/api/sync-progress`) while the dashboard is open.
 * Polls every minute while anything is still syncing, rarely once everything is
 * in, and calls `onNewData` when a sync run wrote rows, so the views fill in
 * without a reload.
 */
import { request } from './api';
import { dateTime, shortDate } from './format';
import type { DatasetProgress, SiteSyncProgress, SyncDataset, SyncProgressResponse } from './types';

const BUSY_MS = 60_000;
const IDLE_MS = 15 * 60_000;

class SyncWatch {
  progress = $state.raw<SyncProgressResponse | null>(null);
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastRunAt: string | null | undefined = undefined;
  private onNewData: (() => void) | null = null;
  private loading = false;
  private started = false;

  start(onNewData: () => void): void {
    this.onNewData = onNewData;
    if (this.started) return;
    this.started = true;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void this.refresh();
    });
    void this.refresh();
  }

  /** `quiet`: the caller already refreshes the views (e.g. after "Sync now"). */
  async refresh(opts: { quiet?: boolean } = {}): Promise<void> {
    if (this.loading) return;
    this.loading = true;
    try {
      const p = await request<SyncProgressResponse>('/api/sync-progress');
      const at = p.lastRun?.at ?? null;
      const wroteRows = this.lastRunAt !== undefined && at !== this.lastRunAt && (p.lastRun?.rowsWritten ?? 0) > 0;
      this.lastRunAt = at;
      this.progress = p;
      if (wroteRows && !opts.quiet) this.onNewData?.();
    } catch {
      // Keep the last report; the views show their own errors.
    } finally {
      this.loading = false;
      this.schedule();
    }
  }

  site(id: string): SiteSyncProgress | undefined {
    return this.progress?.sites.find((s) => s.siteId === id);
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    const p = this.progress;
    const settled = p && p.phase === 'done' && p.paused.length === 0 && p.summary.issues === 0;
    this.timer = setTimeout(
      () => {
        if (document.visibilityState === 'visible') void this.refresh();
        else this.schedule();
      },
      settled ? IDLE_MS : BUSY_MS,
    );
  }
}

export const syncWatch = new SyncWatch();

export const DATASET_LABEL: Record<SyncDataset, string> = {
  gsc: 'Search Console',
  bing: 'Bing',
  ai_crawlers: 'AI crawlers',
  web_analytics: 'Web Analytics',
};

export const SOURCE_LABEL: Record<string, string> = { gsc: 'Search Console', bing: 'Bing', cloudflare: 'Cloudflare' };

/** "at 14:30 UTC", "on Nov 6, 02:30 UTC", or "on the next run" once the time has passed. */
export function when(iso: string | undefined, now = Date.now()): string {
  if (!iso) return 'on the next run';
  const t = Date.parse(iso);
  if (Number.isNaN(t) || t <= now) return 'on the next run';
  const sameDay = new Date(t).toISOString().slice(0, 10) === new Date(now).toISOString().slice(0, 10);
  return sameDay ? `at ${dateTime(iso).split(', ')[1]}` : `on ${dateTime(iso)}`;
}

/** Bing refuses Cloudflare's shared egress IPs (ThrottleIP); nothing on the user's side causes or fixes it. */
export function ipBlocked(reason: string | undefined): boolean {
  return Boolean(reason && /ThrottleIP/i.test(reason));
}

/** Why a source is paused, in one sentence. */
export function pauseText(source: string, reason: string | undefined, until: string | undefined): string {
  const name = SOURCE_LABEL[source] ?? source;
  if (ipBlocked(reason))
    return `${name} refused Cloudflare's network (ThrottleIP), and the Browser Run fallback was refused too. This is on ${name}'s side and does not depend on how much Searchkeep asks. Searchkeep tries again ${when(until)}, and Sync now tries right away. The other sources keep syncing.`;
  return `${name} rate-limited Searchkeep, so it is paused for every site and resumes ${when(until)}, with a longer pause each time it happens again. Sync now tries right away. The other sources keep syncing.`;
}

/** One short line for a dataset's state. */
export function datasetLine(d: DatasetProgress): string {
  switch (d.state) {
    case 'error':
      return `Failed; retrying ${when(d.retryAt)}`;
    case 'paused':
      return ipBlocked(d.message) ? `Blocked by Bing, retrying ${when(d.retryAt)}` : `Paused, resumes ${when(d.retryAt)}`;
    case 'waiting':
      return 'Waiting for the first sync';
    case 'done':
      return d.dataset === 'bing' ? 'All reports in' : d.from ? `Since ${shortDate(d.from, true)}` : 'Up to date';
    case 'syncing':
      if (!d.recent) return 'Latest days syncing';
      if (d.dataset === 'bing') return `${Math.round(d.percent / 25)} of 4 reports`;
      return d.from ? `Back to ${shortDate(d.from, true)} · ${Math.floor(d.percent)}%` : `${Math.floor(d.percent)}%`;
  }
}

/** Bar tone for a dataset. */
export function datasetTone(d: DatasetProgress): 'ok' | 'warn' | 'error' | 'accent' {
  return d.state === 'done' ? 'ok' : d.state === 'error' ? 'error' : d.state === 'paused' ? 'warn' : 'accent';
}

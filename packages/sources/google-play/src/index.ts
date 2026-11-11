/**
 * Google Play adapter (ADR 0009). Reads the Play Console's monthly report files from its Cloud
 * Storage bucket (CSV, usually UTF-16) and crash and ANR rates from the Play Developer Reporting
 * API, as a service account the user invited in the Play Console (by default the Search Console
 * service account). Read-only scopes only.
 */
import {
  readDelimited,
  requestJson,
  SourceError,
  type DateRange,
  type DelimitedRow,
  type PlayClient,
  type PlayObject,
  type PlayVitalsRow,
} from '@searchkeep/core';
import { signServiceAccountJwt } from '@searchkeep/source-gsc';

export const PLAY_SCOPES = 'https://www.googleapis.com/auth/devstorage.read_only https://www.googleapis.com/auth/playdeveloperreporting';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const STORAGE = 'https://storage.googleapis.com/storage/v1';
const REPORTING = 'https://playdeveloperreporting.googleapis.com/v1beta1';
/** The Reporting API aggregates days in Pacific time only. */
const REPORTING_TZ = 'America/Los_Angeles';
const MAX_PAGES = 10;

export interface PlayClientOptions {
  clientEmail: string;
  privateKey: string;
  fetch?: typeof fetch;
}

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

export function clearPlayTokenCache(): void {
  tokenCache.clear();
}

/** `{ year, month, day }` of an ISO date, as the Reporting API's DateTime. */
function dateTime(iso: string) {
  const [year, month, day] = iso.split('-').map(Number);
  return { year, month, day, timeZone: { id: REPORTING_TZ } };
}

function addDay(iso: string): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}

const pad = (n: number | undefined) => String(n ?? 0).padStart(2, '0');

interface MetricsRow {
  startTime?: { year?: number; month?: number; day?: number };
  dimensions?: Array<{ dimension?: string; stringValue?: string; int64Value?: string }>;
  metrics?: Array<{ metric?: string; decimalValue?: { value?: string } }>;
}

export function createPlayClient(opts: PlayClientOptions): PlayClient {
  const f = opts.fetch ?? fetch;

  async function token(): Promise<string> {
    const key = `${opts.clientEmail}|${PLAY_SCOPES}`;
    const cached = tokenCache.get(key);
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
    let assertion: string;
    try {
      assertion = await signServiceAccountJwt(opts.clientEmail, opts.privateKey, PLAY_SCOPES);
    } catch {
      throw new SourceError('play', 0, 'the service account key (PLAY_PRIVATE_KEY, or GSC_PRIVATE_KEY) could not be imported');
    }
    const res = await f(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
    });
    const text = await res.text();
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const j = JSON.parse(text) as { error?: string; error_description?: string };
        detail = `${j.error ?? detail}${j.error_description ? `: ${j.error_description}` : ''}`;
      } catch {
        // ignore
      }
      throw new SourceError('play', res.status, `token exchange failed (${detail})`);
    }
    const j = JSON.parse(text) as { access_token: string; expires_in: number };
    tokenCache.set(key, { token: j.access_token, expiresAt: Date.now() + j.expires_in * 1000 });
    return j.access_token;
  }

  const call = async <T>(url: string, init: { method?: string; body?: unknown } = {}) =>
    requestJson<T>('play', url, { ...init, headers: { authorization: `Bearer ${await token()}` }, fetch: f });

  async function queryVitals(pkg: string, metric: 'crash' | 'anr', range: DateRange): Promise<PlayVitalsRow[]> {
    const set = metric === 'crash' ? 'crashRateMetricSet' : 'anrRateMetricSet';
    const names =
      metric === 'crash' ? ['crashRate', 'userPerceivedCrashRate', 'distinctUsers'] : ['anrRate', 'userPerceivedAnrRate', 'distinctUsers'];
    const out: PlayVitalsRow[] = [];
    let pageToken: string | undefined;
    for (let i = 0; i < MAX_PAGES; i++) {
      const res: { rows?: MetricsRow[]; nextPageToken?: string } = await call(`${REPORTING}/apps/${encodeURIComponent(pkg)}/${set}:query`, {
        method: 'POST',
        body: {
          // The end of the timeline is exclusive.
          timelineSpec: { aggregationPeriod: 'DAILY', startTime: dateTime(range.start), endTime: dateTime(addDay(range.end)) },
          dimensions: ['versionCode'],
          metrics: names,
          pageSize: 10_000,
          ...(pageToken ? { pageToken } : {}),
        },
      });
      for (const r of res?.rows ?? []) {
        const t = r.startTime;
        if (!t?.year) continue;
        const value = (name: string) => {
          const v = r.metrics?.find((m) => m.metric === name)?.decimalValue?.value;
          const n = v === undefined ? NaN : Number(v);
          return Number.isFinite(n) ? n : null;
        };
        const dim = r.dimensions?.find((d) => d.dimension === 'versionCode');
        out.push({
          date: `${t.year}-${pad(t.month)}-${pad(t.day)}`,
          version: dim?.stringValue ?? dim?.int64Value ?? '',
          rate: value(names[0]!),
          userPerceivedRate: value(names[1]!),
          distinctUsers: value('distinctUsers'),
        });
      }
      pageToken = res?.nextPageToken;
      if (!pageToken) break;
    }
    return out;
  }

  return {
    async listObjects(bucket, prefix) {
      const out: PlayObject[] = [];
      let pageToken: string | undefined;
      for (let i = 0; i < MAX_PAGES; i++) {
        const qs = new URLSearchParams({ prefix, maxResults: '1000', fields: 'items(name,generation,size,updated),nextPageToken' });
        if (pageToken) qs.set('pageToken', pageToken);
        const res: { items?: Array<{ name?: string; generation?: string; size?: string; updated?: string }>; nextPageToken?: string } =
          await call(`${STORAGE}/b/${encodeURIComponent(bucket)}/o?${qs.toString()}`);
        for (const o of res?.items ?? []) {
          if (!o.name) continue;
          out.push({ name: o.name, generation: o.generation ?? '', size: Number(o.size ?? 0), updated: o.updated ?? '' });
        }
        pageToken = res?.nextPageToken;
        if (!pageToken) break;
      }
      return out;
    },

    async readCsv(bucket, name, onRow: (row: DelimitedRow) => void) {
      const url = `${STORAGE}/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(name)}?alt=media`;
      let res: Response;
      try {
        res = await f(url, { headers: { authorization: `Bearer ${await token()}` } });
      } catch (err) {
        throw new SourceError('play', 0, `report download failed (${err instanceof Error ? err.name : 'network error'})`);
      }
      if (!res.ok || !res.body) {
        await res.body?.cancel().catch(() => undefined);
        throw new SourceError('play', res.status, `could not read ${name.slice(0, 120)} (HTTP ${res.status})`, {
          rateLimited: res.status === 429,
        });
      }
      return readDelimited(res.body, onRow);
    },

    async canRead(bucket, name) {
      const url = `${STORAGE}/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(name)}?alt=media`;
      let res: Response;
      try {
        res = await f(url, { headers: { authorization: `Bearer ${await token()}`, range: 'bytes=0-0' } });
      } catch (err) {
        throw new SourceError('play', 0, `report download failed (${err instanceof Error ? err.name : 'network error'})`);
      }
      await res.body?.cancel().catch(() => undefined);
      if (res.ok) return true;
      if (res.status === 403 || res.status === 401) return false;
      throw new SourceError('play', res.status, `could not read ${name.slice(0, 120)} (HTTP ${res.status})`, {
        rateLimited: res.status === 429,
      });
    },

    vitals: queryVitals,

    async listApps() {
      const out: Array<{ packageName: string; name: string }> = [];
      let pageToken: string | undefined;
      for (let i = 0; i < 5; i++) {
        const qs = new URLSearchParams({ pageSize: '1000', ...(pageToken ? { pageToken } : {}) });
        const res: { apps?: Array<{ packageName?: string; displayName?: string }>; nextPageToken?: string } = await call(
          `${REPORTING}/apps:search?${qs.toString()}`,
        );
        for (const a of res?.apps ?? []) if (a.packageName) out.push({ packageName: a.packageName, name: a.displayName ?? a.packageName });
        pageToken = res?.nextPageToken;
        if (!pageToken) break;
      }
      return out;
    },
  };
}

/**
 * The Searchkeep Worker. One Worker, three entrances (ADR 0001):
 *   - /mcp      MCP Streamable HTTP for AI clients ("ask")
 *   - /, /api/* the dashboard and its JSON API ("look")
 *   - cron      the daily sync, in small batches
 * All of them call core only. Every request is checked against Cloudflare
 * Access, and the deployment stays locked until Access is set up correctly.
 */
import {
  aiCrawlers,
  aiReferrals,
  comparePeriods,
  findCannibalization,
  findContentDecay,
  findCtrAnomalies,
  findQuickWins,
  findSite,
  geoFunnel,
  inspectUrl,
  listSitemaps,
  listSites,
  loadConfig,
  overview,
  parseAiCitationsCsv,
  queryPerformance,
  READY_FLAG_KEY,
  runSync,
  safeMessage,
  SearchkeepError,
  setupStatus,
  toIsoDate,
  evaluateReadiness,
  type AuthResult,
  type CrawlerQuery,
  type PerformanceDimension,
  type OpsContext,
  type ReadinessReport,
  type SearchkeepConfig,
  type SourceClients,
} from '@searchkeep/core';
import { handleMcpRequest, mcpLockedResponse } from '@searchkeep/mcp';
import { createBingClient } from '@searchkeep/source-bing';
import { createCloudflareClient } from '@searchkeep/source-cloudflare';
import { createGscClient } from '@searchkeep/source-gsc';
import { D1Store, ensureMigrated } from '@searchkeep/store-d1';
import { Hono, type Context } from 'hono';
import { authenticate, inspectAccess, readinessFor } from './auth/access.js';
import { seedDemo } from './dev-seed.js';
import type { Env } from './env.js';
import { setupPage } from './setup-page.js';

export type { Env } from './env.js';

interface Vars {
  config: SearchkeepConfig;
  auth: AuthResult;
  store: D1Store;
  dev: boolean;
}

type CrawlerGroup = CrawlerQuery['groupBy'][number];
type C = Context<{ Bindings: Env; Variables: Vars }>;

export function buildClients(config: SearchkeepConfig): SourceClients {
  const clients: SourceClients = {};
  if (config.gsc.clientEmail && config.gsc.privateKey) {
    clients.gsc = createGscClient({ clientEmail: config.gsc.clientEmail, privateKey: config.gsc.privateKey, allowWrites: config.enableWrites });
  }
  if (config.bing.apiKey) clients.bing = createBingClient({ apiKey: config.bing.apiKey });
  if (config.cloudflare.apiToken) clients.cloudflare = createCloudflareClient({ apiToken: config.cloudflare.apiToken, accountId: config.cloudflare.accountId });
  return clients;
}

function isLocalDev(env: Env, request: Request): boolean {
  if (env.SEARCHKEEP_DEV !== 'true') return false;
  const host = new URL(request.url).hostname;
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
}

const DEV_READINESS = (): ReadinessReport =>
  evaluateReadiness({ configured: true, identityOk: true, inspection: { appFound: true, managedOAuthEnabled: true, broadPolicyReasons: [] } });

/** Remembers in D1 whether the deployment has reached `ready`; cron syncs only while set. */
let readyFlagCache: boolean | null = null;
async function recordReadiness(store: D1Store, report: ReadinessReport): Promise<void> {
  const ready = report.state === 'ready';
  if (readyFlagCache === ready) return;
  if (ready) await store.setMeta(READY_FLAG_KEY, report.checkedAt);
  else await store.deleteMeta(READY_FLAG_KEY);
  readyFlagCache = ready;
}

async function readiness(c: C, refresh = false): Promise<ReadinessReport> {
  if (c.get('dev')) return DEV_READINESS();
  const report = await readinessFor(c.get('auth'), c.get('config'), { refresh });
  // Only authenticated requests may change the flag: an anonymous request to a
  // bypass URL must not be able to switch sync off.
  if (c.get('auth').ok) await recordReadiness(c.get('store'), report);
  return report;
}

function opsContext(c: C): OpsContext {
  const config = c.get('config');
  return { store: c.get('store'), config, clients: buildClients(config) };
}

function errorResponse(c: C, err: unknown) {
  if (err instanceof SearchkeepError) {
    const status = err.code === 'not_found' ? 404 : err.code === 'forbidden' || err.code === 'writes_disabled' ? 403 : err.code === 'upstream' ? 502 : 400;
    return c.json({ error: err.message, code: err.code }, status);
  }
  console.error('request failed', safeMessage(err));
  return c.json({ error: safeMessage(err), code: 'internal' }, 500);
}

function lockedMessage(state: ReadinessReport['state'], origin: string): string {
  switch (state) {
    case 'oauth_disabled':
      return `Searchkeep is locked: enable Managed OAuth on the Cloudflare Access application protecting ${origin}.`;
    case 'policy_too_broad':
      return `Searchkeep is locked: the Cloudflare Access policy for ${origin} lets in more than specific people. Restrict it to your email address.`;
    default:
      return `Searchkeep is locked: ${origin} is not protected by Cloudflare Access yet. See ${origin}/setup.`;
  }
}

// Query-string helpers ------------------------------------------------------

function q(c: C) {
  const url = new URL(c.req.url);
  const get = (k: string) => url.searchParams.get(k) ?? undefined;
  const num = (k: string) => {
    const v = get(k);
    if (v === undefined || v === '') return undefined;
    const n = Number(v);
    if (!Number.isFinite(n)) throw new SearchkeepError('bad_request', `${k} must be a number.`);
    return n;
  };
  const list = <T extends string>(k: string) => (get(k) ? (get(k)!.split(',').filter(Boolean) as T[]) : undefined);
  const strip = <T extends Record<string, unknown>>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
  const common = () =>
    strip({
      site: get('site'),
      start: get('start'),
      end: get('end'),
      days: num('days'),
      source: get('source') as 'gsc' | 'bing' | undefined,
      brand: get('brand') as 'all' | 'brand' | 'non_brand' | undefined,
      limit: num('limit'),
    });
  return { get, num, list, strip, common };
}

// App ---------------------------------------------------------------------

export const app = new Hono<{ Bindings: Env; Variables: Vars }>();

app.get('/healthz', (c) => c.json({ ok: true }));
app.get('/robots.txt', (c) => c.text('User-agent: *\nDisallow: /\n'));
app.get('/setup', (c) => c.html(setupPage(), 200, { 'cache-control': 'no-store', 'x-robots-tag': 'noindex' }));

app.use('*', async (c, next) => {
  const config = loadConfig(c.env as unknown as Record<string, unknown>);
  c.set('config', config);
  const dev = isLocalDev(c.env, c.req.raw);
  c.set('dev', dev);
  c.set('auth', dev ? { ok: true, identity: { email: 'dev@localhost', subject: 'dev', provider: 'dev' } } : await authenticate(c.req.raw, config));
  c.header('x-robots-tag', 'noindex, nofollow');
  c.header('referrer-policy', 'no-referrer');
  c.header('x-content-type-options', 'nosniff');
  c.header('x-frame-options', 'DENY');
  await next();
});

// MCP ------------------------------------------------------------------------

app.all('/mcp', async (c) => {
  const origin = new URL(c.req.url).origin;
  const auth = c.get('auth');
  if (!auth.ok) return mcpLockedResponse(lockedMessage('no_access', origin));
  await ensureMigrated(c.env.DB);
  c.set('store', new D1Store(c.env.DB));
  const report = await readiness(c);
  if (report.state !== 'ready') return mcpLockedResponse(lockedMessage(report.state, origin));
  return handleMcpRequest(c.req.raw, { ctx: opsContext(c), readiness: async () => report });
});

// API ------------------------------------------------------------------------

app.use('/api/*', async (c, next) => {
  const auth = c.get('auth');
  if (!auth.ok) return c.json({ error: 'Searchkeep is locked: Cloudflare Access is not protecting this request.', code: 'locked', state: 'no_access', setup: '/setup' }, 403);
  await ensureMigrated(c.env.DB);
  c.set('store', new D1Store(c.env.DB));
  await next();
});

app.get('/api/status', async (c) => {
  const report = await readiness(c, c.req.query('refresh') === '1');
  const auth = c.get('auth');
  return c.json({ ...report, identity: auth.ok ? { email: auth.identity.email } : null, configErrors: c.get('config').errors, dev: c.get('dev') });
});

// Everything below requires `ready`.
app.use('/api/*', async (c, next) => {
  if (new URL(c.req.url).pathname === '/api/status') return next();
  const report = await readiness(c);
  if (report.state !== 'ready') return c.json({ error: lockedMessage(report.state, new URL(c.req.url).origin), code: 'locked', state: report.state, checks: report.checks }, 403);
  await next();
});

const handle = (fn: (c: C) => Promise<unknown>) => async (c: C) => {
  try {
    return c.json((await fn(c)) as object);
  } catch (err) {
    return errorResponse(c, err);
  }
};

app.get('/api/sites', handle((c) => listSites(opsContext(c))));
app.get('/api/overview', handle((c) => overview(opsContext(c), q(c).common())));
app.get(
  '/api/performance',
  handle((c) => {
    const x = q(c);
    return queryPerformance(
      opsContext(c),
      x.strip({
        ...x.common(),
        dimensions: x.list<PerformanceDimension>('dimensions'),
        queryContains: x.get('queryContains'),
        pageContains: x.get('pageContains'),
        country: x.get('country'),
        device: x.get('device'),
        orderBy: x.get('orderBy') as 'clicks' | undefined,
        order: x.get('order') as 'asc' | 'desc' | undefined,
      }),
    );
  }),
);
app.get(
  '/api/compare',
  handle((c) => {
    const x = q(c);
    return comparePeriods(opsContext(c), x.strip({ ...x.common(), dimension: x.get('dimension') as 'query' | 'page' | undefined, compareStart: x.get('compareStart'), compareEnd: x.get('compareEnd') }));
  }),
);
app.get(
  '/api/quick-wins',
  handle((c) => {
    const x = q(c);
    return findQuickWins(opsContext(c), x.strip({ ...x.common(), minPosition: x.num('minPosition'), maxPosition: x.num('maxPosition'), minImpressions: x.num('minImpressions') }));
  }),
);
app.get(
  '/api/cannibalization',
  handle((c) => {
    const x = q(c);
    return findCannibalization(opsContext(c), x.strip({ ...x.common(), minImpressions: x.num('minImpressions'), minShare: x.num('minShare') }));
  }),
);
app.get(
  '/api/ctr-anomalies',
  handle((c) => {
    const x = q(c);
    return findCtrAnomalies(opsContext(c), x.strip({ ...x.common(), minImpressions: x.num('minImpressions'), threshold: x.num('threshold') }));
  }),
);
app.get(
  '/api/content-decay',
  handle((c) => {
    const x = q(c);
    return findContentDecay(opsContext(c), x.strip({ ...x.common(), weeks: x.num('weeks'), minWeeklyClicks: x.num('minWeeklyClicks'), minDecline: x.num('minDecline') }));
  }),
);
app.get(
  '/api/geo-funnel',
  handle((c) => {
    const x = q(c);
    return geoFunnel(opsContext(c), x.strip({ ...x.common(), pageContains: x.get('pageContains'), sortBy: x.get('sortBy') as 'crawled' | undefined }));
  }),
);
app.get(
  '/api/ai-crawlers',
  handle((c) => {
    const x = q(c);
    return aiCrawlers(opsContext(c), x.strip({ ...x.common(), groupBy: x.list<CrawlerGroup>('groupBy'), crawler: x.get('crawler'), pathContains: x.get('pathContains') }));
  }),
);
app.get(
  '/api/ai-referrals',
  handle((c) => {
    const x = q(c);
    return aiReferrals(opsContext(c), x.strip({ ...x.common(), groupBy: x.list<'path' | 'refererHost' | 'date'>('groupBy') }));
  }),
);
app.get(
  '/api/web-vitals',
  handle(async (c) => {
    const x = q(c);
    const ctx = opsContext(c);
    const site = findSite(ctx.config, x.get('site'));
    const end = x.get('end') ?? toIsoDate(new Date(Date.now() - 86_400_000));
    const days = x.num('days') ?? 28;
    const start = x.get('start') ?? toIsoDate(new Date(Date.parse(`${end}T00:00:00Z`) - (days - 1) * 86_400_000));
    return { site: site.id, range: { start, end }, pages: await ctx.store.queryWebVitals(site.id, { start, end }, Math.min(x.num('limit') ?? 50, 500)) };
  }),
);
app.get(
  '/api/crawl-issues',
  handle(async (c) => {
    const ctx = opsContext(c);
    const site = findSite(ctx.config, q(c).get('site'));
    return { site: site.id, source: 'bing', issues: await ctx.store.listCrawlIssues(site.id, 'bing', 500) };
  }),
);
app.get(
  '/api/sitemaps',
  handle((c) => {
    const x = q(c);
    return listSitemaps(opsContext(c), x.strip({ site: x.get('site'), live: x.get('live') === '1' || x.get('live') === 'true' }));
  }),
);
app.post(
  '/api/inspect',
  handle(async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { site?: string; url?: string };
    if (!body.url) throw new SearchkeepError('bad_request', 'url is required.');
    return inspectUrl(opsContext(c), { url: body.url, ...(body.site ? { site: body.site } : {}) });
  }),
);
app.get('/api/setup-status', handle(async (c) => setupStatus(opsContext(c), { readiness: await readiness(c), probe: c.req.query('probe') !== '0' })));
app.get('/api/sync-runs', handle(async (c) => ({ runs: await c.get('store').listSyncRuns(Math.min(Number(c.req.query('limit') ?? 20) || 20, 100)) })));
app.post(
  '/api/sync',
  handle(async (c) => {
    const ctx = opsContext(c);
    return runSync({ store: ctx.store, config: ctx.config, clients: ctx.clients, trigger: 'manual', timeBudgetMs: 25_000, log: (m) => console.log(m) });
  }),
);
app.post(
  '/api/import/ai-citations',
  handle(async (c) => {
    const ctx = opsContext(c);
    const x = q(c);
    const site = findSite(ctx.config, x.get('site'));
    const text = await c.req.text();
    if (text.length > 5_000_000) throw new SearchkeepError('bad_request', 'CSV is larger than 5 MB.');
    let parsed;
    try {
      parsed = parseAiCitationsCsv(text, { domain: site.domain, defaultDate: x.get('date') ?? toIsoDate(new Date()), surface: x.get('surface') ?? 'bing_copilot' });
    } catch (err) {
      throw new SearchkeepError('bad_request', (err as Error).message);
    }
    const written = await ctx.store.writeAiCitations(site.id, parsed.rows);
    return { site: site.id, imported: parsed.rows.length, skipped: parsed.skipped, rowsWritten: written, columns: parsed.columns };
  }),
);
app.post(
  '/api/dev/seed',
  handle(async (c) => {
    if (!c.get('dev')) throw new SearchkeepError('forbidden', 'Only available in local development.');
    const ctx = opsContext(c);
    const site = findSite(ctx.config, q(c).get('site'));
    await ctx.store.syncSites(ctx.config.sites);
    return { seeded: await seedDemo(ctx.store, site.id, site.domain) };
  }),
);
app.all('/api/*', (c) => c.json({ error: 'Not found', code: 'not_found' }, 404));

// Dashboard ------------------------------------------------------------------

app.all('*', async (c) => {
  if (!c.get('auth').ok) {
    return c.html(setupPage(), 200, { 'cache-control': 'no-store' });
  }
  const res = await c.env.ASSETS.fetch(c.req.raw);
  const headers = new Headers(res.headers);
  headers.set('x-robots-tag', 'noindex, nofollow');
  headers.set('x-frame-options', 'DENY');
  headers.set('referrer-policy', 'no-referrer');
  return new Response(res.body, { status: res.status, headers });
});

// Cron -----------------------------------------------------------------------

export async function scheduledSync(env: Env, now = new Date()): Promise<string> {
  await ensureMigrated(env.DB);
  const store = new D1Store(env.DB);
  const config = loadConfig(env as unknown as Record<string, unknown>);
  if (!(await store.getMeta(READY_FLAG_KEY))) {
    return 'skipped: deployment has not reached the ready state (open the dashboard through Access once)';
  }
  // Re-check through the API: if Access was turned off or loosened, lock again.
  const inspection = await inspectAccess(config);
  const report = evaluateReadiness({ configured: Boolean(config.access.teamDomain && config.access.aud), identityOk: true, inspection, now });
  if (report.state !== 'ready') {
    await store.deleteMeta(READY_FLAG_KEY);
    readyFlagCache = false;
    return `skipped and locked: ${report.state}`;
  }
  const run = await runSync({ store, config, clients: buildClients(config), trigger: 'cron', now, timeBudgetMs: 120_000, log: (m) => console.log(m) });
  return `${run.status}: ${run.rowsWritten} rows${run.message ? ` (${run.message})` : ''}`;
}

export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      scheduledSync(env)
        .then((msg) => console.log(`sync ${msg}`))
        .catch((err) => console.error('sync failed', safeMessage(err))),
    );
  },
} satisfies ExportedHandler<Env>;

import { Miniflare } from 'miniflare';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearJwksCache, READY_FLAG_KEY } from '@searchkeep/core';
import { D1Store } from '@searchkeep/store-d1';
import worker, { scheduledSync, type Env } from '../src/index.js';
import { resetAccessCaches } from '../src/auth/access.js';

const TEAM = 'acme.cloudflareaccess.com';
const AUD = 'aud-123';
const mfs: Miniflare[] = [];
afterAll(async () => Promise.all(mfs.map((m) => m.dispose())));

function b64url(bytes: ArrayBuffer | Uint8Array | string): string {
  const arr = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  for (const b of arr) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const keys = (await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true,
  ['sign', 'verify'],
)) as CryptoKeyPair;
const jwk = { ...((await crypto.subtle.exportKey('jwk', keys.publicKey)) as JsonWebKey), kid: 'k1', alg: 'RS256' };

async function jwt(claims: Record<string, unknown> = {}) {
  const h = b64url(JSON.stringify({ alg: 'RS256', kid: 'k1' }));
  const p = b64url(
    JSON.stringify({ iss: `https://${TEAM}`, aud: [AUD], exp: Math.floor(Date.now() / 1000) + 600, email: 'owner@acme.com', ...claims }),
  );
  const s = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keys.privateKey, new TextEncoder().encode(`${h}.${p}`));
  return `${h}.${p}.${b64url(s)}`;
}

let accessApp: Record<string, unknown>;

function mockFetch() {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === `https://${TEAM}/cdn-cgi/access/certs`) return Response.json({ keys: [jwk] });
    if (url.includes('/access/apps?aud=')) return Response.json({ success: true, result: [accessApp] });
    if (url.includes('/access/apps/app1')) return Response.json({ success: true, result: accessApp });
    throw new Error(`unexpected fetch ${url}`);
  });
}

async function makeEnv(extra: Partial<Env> = {}): Promise<Env> {
  const mf = new Miniflare({ modules: true, script: 'export default {}', d1Databases: { DB: crypto.randomUUID() } });
  mfs.push(mf);
  return {
    DB: (await mf.getD1Database('DB')) as unknown as D1Database,
    ASSETS: {
      fetch: async () => new Response('<!doctype html><title>dashboard</title>', { headers: { 'content-type': 'text/html' } }),
    } as unknown as Fetcher,
    ACCESS_TEAM_DOMAIN: TEAM,
    ACCESS_AUD: AUD,
    CLOUDFLARE_ACCOUNT_ID: 'acct',
    CLOUDFLARE_API_TOKEN: 'cf-token',
    SITES: JSON.stringify([{ id: 'acme', domain: 'acme.com' }]),
    ...extra,
  };
}

const ctx = { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext;
const call = (env: Env, path: string, init: RequestInit = {}) =>
  worker.fetch!(new Request(`https://sk.acme.com${path}`, init) as never, env, ctx) as Promise<Response>;

beforeEach(() => {
  resetAccessCaches();
  clearJwksCache();
  accessApp = {
    id: 'app1',
    aud: AUD,
    oauth_configuration: { enabled: true },
    policies: [{ id: 'p1', name: 'Owner', decision: 'allow', include: [{ email: { email: 'owner@acme.com' } }] }],
  };
  mockFetch();
});

describe('locked until ready', () => {
  it('serves health and the public setup page without Access', async () => {
    const env = await makeEnv();
    expect(await (await call(env, '/healthz')).json()).toEqual({ ok: true });
    const page = await call(env, '/');
    expect(await page.text()).toContain('Searchkeep is locked');
  });

  it('rejects API and MCP calls without a valid Access JWT', async () => {
    const env = await makeEnv();
    const api = await call(env, '/api/sites');
    expect(api.status).toBe(403);
    expect(await api.json()).toMatchObject({ code: 'locked', state: 'no_access' });
    const mcp = await call(env, '/mcp', { method: 'POST', body: '{}' });
    expect(mcp.status).toBe(403);
    expect(((await mcp.json()) as { error: { message: string } }).error.message).toMatch(/not protected by Cloudflare Access/);
    // Tamper with a byte in the middle of the signature (the last base64url char only carries 2 bits).
    const token = await jwt();
    const sigStart = token.lastIndexOf('.') + 1;
    const i = sigStart + 20;
    const tampered = token.slice(0, i) + (token[i] === 'A' ? 'B' : 'A') + token.slice(i + 1);
    const forged = await call(env, '/api/sites', { headers: { 'cf-access-jwt-assertion': tampered } });
    expect(forged.status).toBe(403);
    const wrongAud = await call(env, '/api/sites', { headers: { 'cf-access-jwt-assertion': await jwt({ aud: ['someone-else'] }) } });
    expect(wrongAud.status).toBe(403);
  });

  it('stays locked when secrets are missing, even with a JWT', async () => {
    const env = await makeEnv({ ACCESS_AUD: undefined });
    const res = await call(env, '/api/status', { headers: { 'cf-access-jwt-assertion': await jwt() } });
    expect(res.status).toBe(403);
  });

  it('reports oauth_disabled and policy_too_broad', async () => {
    const env = await makeEnv();
    const headers = { 'cf-access-jwt-assertion': await jwt() };
    accessApp.oauth_configuration = null;
    let status = (await (await call(env, '/api/status', { headers })).json()) as { state: string };
    expect(status.state).toBe('oauth_disabled');
    expect((await call(env, '/api/sites', { headers })).status).toBe(403);
    resetAccessCaches();
    accessApp.oauth_configuration = { enabled: true };
    accessApp.policies = [{ id: 'p1', decision: 'allow', include: [{ email_domain: { domain: 'gmail.com' } }] }];
    status = (await (await call(env, '/api/status', { headers })).json()) as { state: string };
    expect(status.state).toBe('policy_too_broad');
  });

  it('unlocks when everything is set up, and records the ready flag', async () => {
    const env = await makeEnv();
    const headers = { 'cf-access-jwt-assertion': await jwt() };
    const status = (await (await call(env, '/api/status', { headers })).json()) as { state: string; identity: { email: string } };
    expect(status).toMatchObject({ state: 'ready', identity: { email: 'owner@acme.com' } });
    expect((await call(env, '/api/sites', { headers })).status).toBe(200);
    const progress = (await (await call(env, '/api/sync-progress', { headers })).json()) as { phase: string; sites: unknown[] };
    // The test site has no sources connected, so there is nothing to sync.
    expect(progress).toMatchObject({ phase: 'done', sites: [{ siteId: 'acme', phase: 'done', datasets: [] }] });
    // The new tables exist after the Worker's own migration, and their routes answer.
    const coverage = (await (await call(env, '/api/index-coverage', { headers })).json()) as { totals: { urls: number } };
    expect(coverage.totals).toMatchObject({ urls: 0, inspected: 0 });
    const engines = (await (await call(env, '/api/search-crawlers', { headers })).json()) as { totalRequests: number };
    expect(engines.totalRequests).toBe(0);
    const appearance = await call(env, '/api/performance?dimensions=appearance', { headers });
    expect(appearance.status).toBe(200);
    expect(await (await call(env, '/', { headers })).text()).toContain('dashboard');
    expect(await new D1Store(env.DB).getMeta(READY_FLAG_KEY)).not.toBeNull();
    const mcp = await call(env, '/mcp', {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(mcp.status).toBe(200);
  });

  it('never honours dev mode off localhost', async () => {
    const env = await makeEnv({ SEARCHKEEP_DEV: 'true' });
    expect((await call(env, '/api/sites')).status).toBe(403);
  });
});

describe('cron', () => {
  it('does not sync before the deployment was ready, and re-locks when Access is loosened', async () => {
    const env = await makeEnv();
    expect(await scheduledSync(env)).toMatch(/^not ready/);
    await call(env, '/api/status', { headers: { 'cf-access-jwt-assertion': await jwt() } });
    expect(await scheduledSync(env)).toMatch(/^(ok|skipped|partial):/);
    resetAccessCaches();
    accessApp.policies = [{ id: 'p1', decision: 'allow', include: [{ everyone: {} }] }];
    expect(await scheduledSync(env)).toMatch(/locked: policy_too_broad/);
    expect(await new D1Store(env.DB).getMeta(READY_FLAG_KEY)).toBeNull();
  });
});

describe('sites managed in the dashboard', () => {
  it('creates, lists, uses and deletes a site; secret sites are read-only', async () => {
    const env = await makeEnv();
    const headers = { 'cf-access-jwt-assertion': await jwt(), 'content-type': 'application/json' };
    const post = (body: unknown) => call(env, '/api/site-configs', { method: 'POST', headers, body: JSON.stringify(body) });

    const bad = await post({ domain: 'not a domain' });
    expect(bad.status).toBe(400);

    const created = await post({ mode: 'create', domain: 'https://Blog.Acme.com/', bingSiteUrl: 'blog.acme.com' });
    expect(created.status).toBe(200);
    expect(await created.json()).toMatchObject({
      site: { id: 'blog-acme-com', domain: 'blog.acme.com', bingSiteUrl: 'https://blog.acme.com/', origin: 'dashboard' },
      created: true,
    });

    const dup = await post({ mode: 'create', domain: 'blog.acme.com' });
    expect(dup.status).toBe(400);
    const updated = await post({ id: 'blog-acme-com', domain: 'blog.acme.com', brandRegex: 'acme' });
    expect(await updated.json()).toMatchObject({ created: false, site: { brandRegex: 'acme' } });

    const list = (await (await call(env, '/api/site-configs', { headers })).json()) as { sites: Array<{ id: string; origin: string }> };
    expect(list.sites.map((s) => [s.id, s.origin])).toEqual([
      ['acme', 'secret'],
      ['blog-acme-com', 'dashboard'],
    ]);
    // The new site is usable everywhere (API, MCP, cron) right away.
    const sites = (await (await call(env, '/api/sites', { headers })).json()) as { sites: Array<{ id: string }> };
    expect(sites.sites.map((s) => s.id)).toContain('blog-acme-com');

    const editSecret = await post({ id: 'acme', domain: 'acme.com', brandRegex: 'x' });
    expect(editSecret.status).toBe(403);
    expect((await call(env, '/api/site-configs/acme', { method: 'DELETE', headers })).status).toBe(403);
    const del = await call(env, '/api/site-configs/blog-acme-com', { method: 'DELETE', headers });
    expect(await del.json()).toMatchObject({ deleted: 'blog-acme-com' });
    expect((await call(env, '/api/site-configs/blog-acme-com', { method: 'DELETE', headers })).status).toBe(404);
  });

  it('manages apps, and starts App Store reports with an Admin key it never stores or returns', async () => {
    const env = await makeEnv({ ASC_KEY_ID: 'SALES1', ASC_ISSUER_ID: 'issuer', ASC_PRIVATE_KEY: 'not-used-here' });
    const headers = { 'cf-access-jwt-assertion': await jwt(), 'content-type': 'application/json' };
    const post = (path: string, body: unknown) => call(env, path, { method: 'POST', headers, body: JSON.stringify(body) });

    expect((await post('/api/app-configs', { name: 'Acme' })).status).toBe(400);
    expect((await post('/api/app-configs', { name: 'Acme', appleId: '1234567', siteId: 'nope' })).status).toBe(400);
    const created = await post('/api/app-configs', { mode: 'create', name: 'Acme App', appleId: 'id1234567', siteId: 'acme' });
    expect(await created.json()).toMatchObject({
      app: { id: 'acme-app', appleId: '1234567', siteId: 'acme', origin: 'dashboard' },
      created: true,
    });
    const apps = (await (await call(env, '/api/apps', { headers })).json()) as { apps: Array<Record<string, unknown>> };
    expect(apps.apps).toEqual([
      expect.objectContaining({
        id: 'acme-app',
        stores: { appStore: true, googlePlay: false, appStorePublic: false },
        appStoreReports: { started: false, stopped: false, snapshot: false },
      }),
    ]);

    // A temporary Admin key: the Worker calls App Store Connect with it once.
    const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign'])) as CryptoKeyPair;
    const der = new Uint8Array((await crypto.subtle.exportKey('pkcs8', pair.privateKey)) as ArrayBuffer);
    let bin = '';
    for (const b of der) bin += String.fromCharCode(b);
    const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(bin)}\n-----END PRIVATE KEY-----`;
    const ascCalls: string[] = [];
    const base = globalThis.fetch;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.startsWith('https://api.appstoreconnect.apple.com/')) {
        ascCalls.push(`${init?.method ?? 'GET'} ${url.replace('https://api.appstoreconnect.apple.com', '')}`);
        if (init?.method === 'POST') {
          const accessType = JSON.parse(String(init.body)).data.attributes.accessType;
          return Response.json(
            { data: { id: `req-${accessType}`, attributes: { accessType, stoppedDueToInactivity: false } } },
            { status: 201 },
          );
        }
        return Response.json({ data: [] });
      }
      return base(input, init);
    });
    const missing = await post('/api/app-configs/acme-app/enable-app-store', { keyId: 'ADMIN1' });
    expect(missing.status).toBe(400);
    const res = await post('/api/app-configs/acme-app/enable-app-store', { keyId: 'ADMIN1', issuerId: 'issuer', privateKey: pem });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain('PRIVATE KEY');
    expect(text).not.toContain(btoa(bin).slice(0, 40));
    expect(JSON.parse(text)).toMatchObject({
      ongoing: { id: 'req-ONGOING', created: true },
      snapshot: { id: 'req-ONE_TIME_SNAPSHOT', created: true },
    });
    expect(ascCalls).toEqual([
      'GET /v1/apps/1234567/analyticsReportRequests?limit=200',
      'POST /v1/analyticsReportRequests',
      'POST /v1/analyticsReportRequests',
    ]);
    // Only the request ids are kept.
    const meta = await new D1Store(env.DB).listMeta('');
    expect(JSON.stringify(meta)).not.toContain('ADMIN1');
    expect(JSON.stringify(meta)).not.toContain('PRIVATE');
    expect(JSON.parse(meta['app:asc:req:acme-app']!)).toMatchObject({ ongoing: 'req-ONGOING', snapshot: 'req-ONE_TIME_SNAPSHOT' });

    const del = await call(env, '/api/app-configs/acme-app', { method: 'DELETE', headers });
    expect(await del.json()).toMatchObject({ deleted: 'acme-app' });
    expect((await call(env, '/api/apps', { headers }).then((r) => r.json())) as unknown).toEqual({ apps: [] });
  });

  it('stays locked without an API token, even when no sites are configured', async () => {
    const env = await makeEnv({ SITES: undefined, CLOUDFLARE_API_TOKEN: undefined });
    const headers = { 'cf-access-jwt-assertion': await jwt(), 'content-type': 'application/json' };
    // Without a Cloudflare API token the Access check cannot run, so the API stays locked.
    expect((await call(env, '/api/site-configs', { headers })).status).toBe(403);
  });
});

describe('site icon', () => {
  it('serves the icon read from the site itself, sandboxed, behind Access', async () => {
    const env = await makeEnv();
    const headers = { 'cf-access-jwt-assertion': await jwt() };
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
    const base = globalThis.fetch;
    let hasIcon = true;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url === 'https://acme.com/')
        return new Response('<link rel="icon" href="/logo.png">', { headers: { 'content-type': 'text/html' } });
      if (url === 'https://acme.com/logo.png' && hasIcon) return new Response(png, { headers: { 'content-type': 'image/png' } });
      if (url.startsWith('https://acme.com/')) return new Response('missing', { status: 404 });
      return base(input, init);
    });

    const res = await call(env, '/api/site-icon?site=acme', { headers });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('cache-control')).toBe('private, max-age=86400');
    expect(res.headers.get('content-security-policy')).toContain('sandbox');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(png);

    hasIcon = false;
    const none = await call(env, '/api/site-icon?site=acme', { headers });
    expect(none.status).toBe(404);
    expect(none.headers.get('cache-control')).toBe('private, max-age=3600');
    expect((await call(env, '/api/site-icon?site=nope', { headers })).status).toBe(404);
    expect((await call(env, '/api/site-icon?site=acme')).status).toBe(403);
  });
});

describe('app icon', () => {
  it("serves the linked site's icon when App Store Connect is not set up, behind Access", async () => {
    const env = await makeEnv({ APPS: JSON.stringify([{ id: 'acme-app', name: 'Acme', playPackage: 'com.acme.app', siteId: 'acme' }]) });
    const headers = { 'cf-access-jwt-assertion': await jwt() };
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
    const base = globalThis.fetch;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url === 'https://acme.com/apple-touch-icon.png') return new Response(png, { headers: { 'content-type': 'image/png' } });
      if (url.startsWith('https://acme.com/')) return new Response('missing', { status: 404 });
      return base(input, init);
    });

    const res = await call(env, '/api/app-icon?app=acme-app', { headers });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('content-security-policy')).toContain('sandbox');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(png);
    expect((await call(env, '/api/app-icon?app=nope', { headers })).status).toBe(404);
    expect((await call(env, '/api/app-icon?app=acme-app')).status).toBe(403);
  });
});

describe('Browser Run transport', () => {
  it('opens nothing until used, and only does GET', async () => {
    const { createBrowserFetch } = await import('../src/browser-fetch.js');
    const browser = createBrowserFetch({ fetch: async () => new Response('unused') } as never);
    expect(browser.used).toBe(false);
    await expect(browser.fetch('https://ssl.bing.com/', { method: 'POST', body: 'x' })).rejects.toThrow(/GET only/);
    expect(browser.used).toBe(false);
    await browser.close();
  });
});

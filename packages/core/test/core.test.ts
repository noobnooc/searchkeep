import { describe, expect, it } from 'vitest';
import {
  addMonths,
  capCrawlerRows,
  classifyCrawler,
  classifySearchCrawler,
  inPropertyScope,
  OTHER_PAGES,
  segmentsEnabled,
  clearJwksCache,
  evaluateReadiness,
  findSiteIcon,
  geoFunnel,
  isRateLimited,
  loadConfig,
  normalizeDomain,
  normalizePage,
  OidcVerifier,
  parseAiCitationsCsv,
  parseIconLinks,
  parseRetryAfter,
  requestJson,
  safeMessage,
  SearchkeepError,
  sniffImage,
  validateSite,
  weekStart,
  withStoredSites,
} from '../src/index.js';
import type { Store } from '../src/index.js';

function b64url(bytes: ArrayBuffer | Uint8Array | string): string {
  const arr = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  for (const b of arr) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function issuer() {
  const pair = (await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey('jwk', pair.publicKey)) as JsonWebKey;
  const sign = async (claims: Record<string, unknown>, kid = 'k1') => {
    const h = b64url(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' }));
    const p = b64url(JSON.stringify(claims));
    const s = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(`${h}.${p}`));
    return `${h}.${p}.${b64url(s)}`;
  };
  return { jwks: { keys: [{ ...jwk, kid: 'k1', alg: 'RS256' }] }, sign };
}

describe('OidcVerifier', () => {
  const ISS = 'https://team.cloudflareaccess.com';
  const now = 1_800_000_000;
  const make = async () => {
    clearJwksCache();
    const iss = await issuer();
    const fetchMock = (async () => new Response(JSON.stringify(iss.jwks))) as unknown as typeof fetch;
    const v = new OidcVerifier({
      issuer: ISS,
      jwksUrl: `${ISS}/cdn-cgi/access/certs`,
      audience: 'aud1',
      fetch: fetchMock,
      now: () => now * 1000,
    });
    return { v, sign: iss.sign };
  };

  it('accepts a valid token', async () => {
    const { v, sign } = await make();
    const res = await v.verify(await sign({ iss: ISS, aud: ['aud1'], exp: now + 60, email: 'me@acme.com' }));
    expect(res).toMatchObject({ ok: true, claims: { email: 'me@acme.com' } });
  });

  it('rejects wrong audience, issuer, expiry and tampering', async () => {
    const { v, sign } = await make();
    expect(await v.verify(await sign({ iss: ISS, aud: ['other'], exp: now + 60 }))).toMatchObject({
      ok: false,
      reason: 'audience mismatch',
    });
    expect(await v.verify(await sign({ iss: 'https://evil.cloudflareaccess.com', aud: ['aud1'], exp: now + 60 }))).toMatchObject({
      ok: false,
      reason: 'issuer mismatch',
    });
    expect(await v.verify(await sign({ iss: ISS, aud: ['aud1'], exp: now - 3600 }))).toMatchObject({ ok: false, reason: 'token expired' });
    const t = await sign({ iss: ISS, aud: ['aud1'], exp: now + 60 });
    const [h, , s] = t.split('.');
    const forged = `${h}.${b64url(JSON.stringify({ iss: ISS, aud: ['aud1'], exp: now + 60, email: 'attacker@x.com' }))}.${s}`;
    expect(await v.verify(forged)).toMatchObject({ ok: false, reason: 'bad signature' });
    expect(await v.verify('garbage')).toMatchObject({ ok: false });
  });

  it('rejects tokens signed by an unknown key', async () => {
    const { v } = await make();
    const other = await issuer();
    expect(await v.verify(await other.sign({ iss: ISS, aud: ['aud1'], exp: now + 60 }, 'k2'))).toMatchObject({
      ok: false,
      reason: 'signing key not found in JWKS',
    });
  });

  it('rejects alg=none', async () => {
    const { v } = await make();
    const token = `${b64url(JSON.stringify({ alg: 'none' }))}.${b64url(JSON.stringify({ iss: ISS, aud: 'aud1', exp: now + 60 }))}.`;
    expect(await v.verify(token)).toMatchObject({ ok: false });
  });
});

describe('readiness', () => {
  const insp = { appFound: true, managedOAuthEnabled: true, broadPolicyReasons: [] as string[] };
  it('walks through the four states', () => {
    expect(evaluateReadiness({ configured: false, identityOk: false, inspection: null }).state).toBe('no_access');
    expect(evaluateReadiness({ configured: true, identityOk: false, inspection: insp }).state).toBe('no_access');
    expect(evaluateReadiness({ configured: true, identityOk: true, inspection: { ...insp, managedOAuthEnabled: false } }).state).toBe(
      'oauth_disabled',
    );
    expect(evaluateReadiness({ configured: true, identityOk: true, inspection: null }).state).toBe('oauth_disabled');
    expect(evaluateReadiness({ configured: true, identityOk: true, inspection: { ...insp, broadPolicyReasons: ['Everyone'] } }).state).toBe(
      'policy_too_broad',
    );
    expect(evaluateReadiness({ configured: true, identityOk: true, inspection: insp }).state).toBe('ready');
  });
});

describe('config', () => {
  it('parses sites and reports problems without throwing', () => {
    const c = loadConfig({
      SITES: JSON.stringify([{ domain: 'www.Acme.com' }, { id: 'Bad Id', domain: 'x.com' }, { id: 'b', domain: 'b.com', brandRegex: '(' }]),
      GSC_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----',
      ACCESS_TEAM_DOMAIN: 'https://team.cloudflareaccess.com/',
    });
    expect(c.sites.map((s) => s.id)).toEqual(['acme-com']);
    expect(c.sites[0]!.origin).toBe('secret');
    expect(c.errors).toHaveLength(2);
    expect(c.gsc.privateKey).toContain('\n');
    expect(c.access.teamDomain).toBe('team.cloudflareaccess.com');
    expect(c.enableWrites).toBe(false);
    expect(loadConfig({ SITES: 'nope' }).errors[0]).toMatch(/JSON/);
  });
});

describe('search console options', () => {
  it('parses search types, appearance, segments and inspections with defaults', () => {
    const defaults = loadConfig({});
    expect(defaults.gsc).toMatchObject({
      searchTypes: ['image', 'video', 'news', 'discover', 'googleNews'],
      searchAppearance: true,
      segmentSites: [],
      inspectionsPerDay: 200,
    });
    expect(segmentsEnabled(defaults, 'acme')).toBe(false);
    const set = loadConfig({
      GSC_SEARCH_TYPES: 'Image, discover,web,bogus',
      GSC_SEARCH_APPEARANCE: 'false',
      GSC_SEGMENT_SITES: 'acme, beta',
      GSC_INSPECTIONS_PER_DAY: '5000',
    });
    expect(set.gsc).toMatchObject({
      searchTypes: ['image', 'discover'],
      searchAppearance: false,
      segmentSites: ['acme', 'beta'],
      inspectionsPerDay: 2000,
    });
    expect(set.errors).toEqual([expect.stringContaining('GSC_SEARCH_TYPES: unknown search type "bogus"')]);
    expect(segmentsEnabled(set, 'beta')).toBe(true);
    expect(loadConfig({ GSC_SEARCH_TYPES: 'none' }).gsc.searchTypes).toEqual([]);
    expect(segmentsEnabled(loadConfig({ GSC_SEGMENT_SITES: 'ALL' }), 'any')).toBe(true);
  });
});

describe('sites', () => {
  it('validates and normalizes a site from the dashboard', () => {
    const res = validateSite({
      domain: 'https://www.Example.com/blog?x=1',
      bingSiteUrl: 'example.com',
      gscProperty: 'sc-domain:example.com',
    });
    expect(res).toEqual({
      site: { id: 'example-com', domain: 'www.example.com', gscProperty: 'sc-domain:example.com', bingSiteUrl: 'https://example.com/' },
    });
    expect(validateSite({ domain: 'not a domain' })).toHaveProperty('error');
    expect(validateSite({ domain: 'a.com', gscProperty: 'example.com' })).toHaveProperty('error');
    expect(validateSite({ domain: 'a.com', brandRegex: '(' })).toHaveProperty('error');
    expect(validateSite({ domain: 'a.com', cloudflareZoneId: 'x y' })).toHaveProperty('error');
    expect(normalizeDomain(' HTTPS://Docs.Acme.com:443/path ')).toBe('docs.acme.com');
  });

  it('merges dashboard sites, secret wins on id conflicts', () => {
    const c = loadConfig({ SITES: JSON.stringify([{ id: 'acme', domain: 'acme.com' }]) });
    const merged = withStoredSites(c, [
      { id: 'acme', domain: 'other.com' },
      { id: 'blog', domain: 'blog.acme.com' },
    ]);
    expect(merged.sites).toEqual([
      { id: 'acme', domain: 'acme.com', origin: 'secret' },
      { id: 'blog', domain: 'blog.acme.com', origin: 'dashboard' },
    ]);
    expect(withStoredSites(c, [])).toBe(c);
  });
});

describe('helpers', () => {
  it('normalizes pages across sources', () => {
    expect(normalizePage('https://www.acme.com/a/b?x=1#y', 'acme.com')).toBe('/a/b');
    expect(normalizePage('https://docs.acme.com/start', 'acme.com')).toBe('//docs.acme.com/start');
    expect(normalizePage('/p', 'acme.com', 'acme.com')).toBe('/p');
    expect(normalizePage('', 'acme.com')).toBe('/');
  });
  it('handles dates', () => {
    expect(weekStart('2026-11-08')).toBe('2026-11-02');
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28');
  });
  it('classifies AI crawlers', () => {
    expect(
      classifyCrawler('Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)')?.name,
    ).toBe('ClaudeBot');
    expect(classifyCrawler('Mozilla/5.0 (compatible; ChatGPT-User/1.0)')?.purpose).toBe('user');
    expect(classifyCrawler('Mozilla/5.0 (Macintosh)')).toBeNull();
  });
  it('classifies search engine crawlers, most specific first, and leaves AI crawlers alone', () => {
    expect(classifySearchCrawler('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)')).toMatchObject({
      name: 'Googlebot',
      operator: 'Google',
      purpose: 'search',
    });
    expect(classifySearchCrawler('Googlebot-Image/1.0')).toMatchObject({ name: 'Googlebot-Image', purpose: 'media' });
    expect(classifySearchCrawler('AdsBot-Google (+http://www.google.com/adsbot.html)')).toMatchObject({ purpose: 'ads' });
    expect(classifySearchCrawler('Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)')).toMatchObject({
      name: 'Bingbot',
      operator: 'Microsoft',
    });
    expect(classifySearchCrawler('Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)')).toBeNull();
    expect(classifySearchCrawler('Mozilla/5.0 (Macintosh) Safari/605.1.15')).toBeNull();
  });

  it('caps search crawler rows per day, folding the rest into one row per crawler and status', () => {
    const rows = [1, 2, 3, 4, 5].map((n) => ({
      date: '2026-10-01',
      crawler: 'Googlebot',
      operator: 'Google',
      purpose: 'search' as const,
      path: `/p${n}`,
      status: n === 5 ? 404 : 200,
      requests: 10 - n,
    }));
    const capped = capCrawlerRows([...rows, { ...rows[0]!, date: '2026-10-02' }], 3);
    expect(capped.map((r) => [r.date, r.path, r.status, r.requests])).toEqual([
      ['2026-10-01', '/p1', 200, 9],
      ['2026-10-01', '/p2', 200, 8],
      [`2026-10-01`, OTHER_PAGES, 200, 13],
      ['2026-10-01', OTHER_PAGES, 404, 5],
      ['2026-10-02', '/p1', 200, 9],
    ]);
  });

  it('keeps inspection URLs inside the Search Console property', () => {
    expect(inPropertyScope('https://blog.acme.com/x', 'sc-domain:acme.com')).toBe(true);
    expect(inPropertyScope('http://acme.com/', 'sc-domain:acme.com')).toBe(true);
    expect(inPropertyScope('https://notacme.com/', 'sc-domain:acme.com')).toBe(false);
    expect(inPropertyScope('https://acme.com/docs/a', 'https://acme.com/docs/')).toBe(true);
    expect(inPropertyScope('https://acme.com/blog/a', 'https://acme.com/docs/')).toBe(false);
    expect(inPropertyScope('ftp://acme.com/a', 'sc-domain:acme.com')).toBe(false);
  });

  it('redacts secrets from messages', () => {
    expect(safeMessage(new Error('GET https://x/?apikey=abc123 failed, Bearer eyJhbGciOi.x.y'))).toBe(
      'GET https://x/?apikey=[redacted] failed, Bearer [redacted]',
    );
  });
  it('parses AI citation CSV exports', () => {
    const csv =
      '﻿Page URL,Citations,Date\r\n"https://acme.com/a?x=1","1,204",2026-10-01\r\nhttps://acme.com/b,3,2026-10-02\r\n,5,2026-10-02\r\n';
    const res = parseAiCitationsCsv(csv, { domain: 'acme.com', defaultDate: '2026-10-31' });
    expect(res.rows).toEqual([
      { date: '2026-10-01', page: '/a', surface: 'bing_copilot', citations: 1204 },
      { date: '2026-10-02', page: '/b', surface: 'bing_copilot', citations: 3 },
    ]);
    expect(res.skipped).toBe(1);
    expect(parseAiCitationsCsv('URL;Cited\n/x;2', { domain: 'acme.com', defaultDate: '2026-10-31' }).rows[0]).toMatchObject({
      date: '2026-10-31',
      page: '/x',
    });
  });
});

describe('requestJson', () => {
  it('parses Retry-After as seconds or a date', () => {
    expect(parseRetryAfter('120')).toBe(120_000);
    expect(parseRetryAfter('Tue, 20 Oct 2026 04:01:00 GMT', Date.parse('2026-10-20T04:00:00Z'))).toBe(60_000);
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter('soon')).toBeNull();
  });

  it('flags rate limits and leaves long waits to the caller', async () => {
    let calls = 0;
    const f = (async () => {
      calls++;
      return new Response('{"error":"slow down"}', { status: 429, headers: { 'retry-after': '3600' } });
    }) as unknown as typeof fetch;
    const err = await requestJson('x', 'https://x.test/', { fetch: f }).catch((e: unknown) => e);
    expect(isRateLimited(err)).toBe(true);
    expect((err as { retryAfterMs: number }).retryAfterMs).toBe(3_600_000);
    expect(calls).toBe(1);

    calls = 0;
    const custom = (async () => {
      calls++;
      return new Response('{"code":"QUOTA"}', { status: 400 });
    }) as unknown as typeof fetch;
    const quota = await requestJson('x', 'https://x.test/', { fetch: custom, rateLimited: (_s, body) => body.includes('QUOTA') }).catch(
      (e: unknown) => e,
    );
    expect(isRateLimited(quota)).toBe(true);
    expect(calls).toBe(1);
    const plain = await requestJson('x', 'https://x.test/', { fetch: custom }).catch((e: unknown) => e);
    expect(isRateLimited(plain)).toBe(false);
  });
});

describe('geoFunnel', () => {
  // A store with three pages: /a is the most crawled, /b has the most impressions, /c the most clicks.
  const store = {
    queryCrawlers: async () => [
      { path: '/a', requests: 30 },
      { path: '/b', requests: 10 },
      { path: '/c', requests: 20 },
    ],
    queryAiCitations: async () => [],
    queryReferrals: async () => [],
    queryPerformance: async (q: { source: string }) =>
      q.source === 'gsc'
        ? [
            { page: '/a', clicks: 1, impressions: 50 },
            { page: '/b', clicks: 2, impressions: 900 },
            { page: '/c', clicks: 9, impressions: 300 },
          ]
        : [],
  } as unknown as Store;
  const ctx = { store, config: loadConfig({ SITES: JSON.stringify([{ domain: 'acme.com' }]) }) };
  const range = { start: '2026-10-01', end: '2026-10-28' };

  it('sorts pages by any step, and by impressions', async () => {
    const order = async (sortBy?: 'crawled' | 'clicks' | 'impressions') =>
      (await geoFunnel(ctx, { ...range, ...(sortBy ? { sortBy } : {}) })).pages.map((p) => p.page);
    expect(await order()).toEqual(['/a', '/c', '/b']);
    expect(await order('clicks')).toEqual(['/c', '/b', '/a']);
    expect(await order('impressions')).toEqual(['/b', '/c', '/a']);
  });

  it('rejects an unknown sort key', async () => {
    await expect(geoFunnel(ctx, { ...range, sortBy: 'position' as 'crawled' })).rejects.toBeInstanceOf(SearchkeepError);
  });
});

describe('site icon', () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
  const ICO = new Uint8Array([0, 0, 1, 0, 1, 0, 16, 16]);

  it('ranks declared icons: apple-touch-icon first, then SVG and the largest, links with media last', () => {
    const html = `<!doctype html><head>
      <!-- <link rel="apple-touch-icon" href="/commented.png"> -->
      <link rel="icon" href="/favicon-16.png" sizes="16x16">
      <link rel="mask-icon" href="/pinned.svg" color="#000">
      <link rel="icon" href="/dark.svg" media="(prefers-color-scheme: dark)">
      <LINK REL="Shortcut Icon" HREF='/favicon.ico'>
      <link href="/icon.svg" rel="icon" type="image/svg+xml" />
      <link rel="icon" href="data:image/svg+xml,%3Csvg%3E">
      <link rel="apple-touch-icon" href="/apple-120.png" sizes="120x120">
      <link rel="apple-touch-icon" href="https://cdn.acme.com/apple.png?v=1&amp;x=2">
      <script>document.write('<link rel="icon" href="/script.png">')</script>
    </head>`;
    expect(parseIconLinks(html, 'https://www.acme.com/').map((l) => [l.kind, l.url])).toEqual([
      ['apple-touch-icon', 'https://cdn.acme.com/apple.png?v=1&x=2'],
      ['apple-touch-icon', 'https://www.acme.com/apple-120.png'],
      ['icon', 'https://www.acme.com/icon.svg'],
      ['icon', 'https://www.acme.com/favicon-16.png'],
      ['icon', 'https://www.acme.com/favicon.ico'],
      ['icon', 'https://www.acme.com/dark.svg'],
    ]);
  });

  it('recognizes images by their bytes, not by an HTML page', () => {
    const text = (s: string) => new TextEncoder().encode(s);
    expect(sniffImage(PNG)).toBe('image/png');
    expect(sniffImage(ICO)).toBe('image/x-icon');
    expect(sniffImage(text('GIF89a'))).toBe('image/gif');
    expect(sniffImage(text('\uFEFF <?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBe('image/svg+xml');
    expect(sniffImage(text('<!doctype html><title>Not found</title><svg></svg>'))).toBeNull();
    expect(sniffImage(text('<html><body>404</body></html>'))).toBeNull();
    expect(sniffImage(new Uint8Array())).toBeNull();
  });

  const site = (files: Record<string, () => Response>) => {
    const fetched: string[] = [];
    const fetchMock = (async (input: RequestInfo | URL) => {
      const url = String(input);
      fetched.push(url);
      const file = files[url];
      if (!file) return new Response('<!doctype html><title>Not found</title>', { status: 404, headers: { 'content-type': 'text/html' } });
      return file();
    }) as typeof fetch;
    return { fetch: fetchMock, fetched };
  };

  it('uses the declared apple-touch-icon and skips URLs off the site domain', async () => {
    const s = site({
      'https://acme.com/': () =>
        new Response(
          '<link rel="apple-touch-icon" href="https://elsewhere.net/a.png"><link rel="apple-touch-icon" href="/touch.png"><link rel="icon" href="/i.svg">',
        ),
      'https://acme.com/touch.png': () => new Response(PNG, { headers: { 'content-type': 'application/octet-stream' } }),
    });
    const icon = await findSiteIcon('acme.com', { fetch: s.fetch });
    expect(icon).toMatchObject({ contentType: 'image/png', url: 'https://acme.com/touch.png' });
    expect(s.fetched).toEqual(['https://acme.com/', 'https://acme.com/touch.png']);
  });

  it('falls back from soft 404s to the conventional locations, and to null', async () => {
    const soft404 = () => new Response('<!doctype html><title>Home</title>', { headers: { 'content-type': 'image/png' } });
    const s = site({
      'https://acme.com/': () => new Response('<link rel="icon" href="/missing.png">'),
      'https://acme.com/apple-touch-icon.png': soft404,
      'https://acme.com/favicon.ico': () => new Response(ICO),
    });
    expect(await findSiteIcon('acme.com', { fetch: s.fetch })).toMatchObject({
      contentType: 'image/x-icon',
      url: 'https://acme.com/favicon.ico',
    });
    expect(s.fetched).toEqual([
      'https://acme.com/',
      'https://acme.com/apple-touch-icon.png',
      'https://acme.com/missing.png',
      'https://acme.com/favicon.ico',
    ]);

    const down = (async () => {
      throw new TypeError('network down');
    }) as typeof fetch;
    expect(await findSiteIcon('acme.com', { fetch: down })).toBeNull();
    const big = site({ 'https://acme.com/favicon.ico': () => new Response(new Uint8Array(2_000).map((_, i) => ICO[i] ?? 1)) });
    expect(await findSiteIcon('acme.com', { fetch: big.fetch, maxBytes: 1_000 })).toBeNull();
  });

  it('drops off-domain links before limiting them, so an on-domain icon is still tried', async () => {
    const s = site({
      'https://acme.com/': () =>
        new Response(
          '<link rel="icon" href="https://a.example/1.svg"><link rel="icon" href="https://b.example/2.svg"><link rel="icon" href="/own.png">',
        ),
      'https://acme.com/own.png': () => new Response(PNG),
    });
    expect(await findSiteIcon('acme.com', { fetch: s.fetch })).toMatchObject({ url: 'https://acme.com/own.png' });
    expect(s.fetched.some((u) => u.includes('.example/'))).toBe(false);
  });

  it('follows redirects only while they stay on the site domain', async () => {
    const redirect = (to: string) => () => new Response(null, { status: 301, headers: { location: to } });
    const s = site({
      'https://acme.com/': redirect('https://www.acme.com/'),
      'https://www.acme.com/': () => new Response('<link rel="apple-touch-icon" href="/touch.png">'),
      'https://www.acme.com/touch.png': redirect('https://icons.example/acme.png'),
      'https://acme.com/apple-touch-icon.png': redirect('/static/touch.png'),
      'https://acme.com/static/touch.png': () => new Response(PNG),
    });
    expect(await findSiteIcon('acme.com', { fetch: s.fetch })).toMatchObject({
      contentType: 'image/png',
      url: 'https://acme.com/apple-touch-icon.png',
    });
    expect(s.fetched).toEqual([
      'https://acme.com/',
      'https://www.acme.com/',
      'https://www.acme.com/touch.png',
      'https://acme.com/apple-touch-icon.png',
      'https://acme.com/static/touch.png',
    ]);
  });
});

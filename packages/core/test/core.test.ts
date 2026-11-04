import { describe, expect, it } from 'vitest';
import {
  addMonths,
  classifyCrawler,
  clearJwksCache,
  evaluateReadiness,
  loadConfig,
  normalizeDomain,
  normalizePage,
  OidcVerifier,
  parseAiCitationsCsv,
  safeMessage,
  validateSite,
  weekStart,
  withStoredSites,
} from '../src/index.js';

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

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

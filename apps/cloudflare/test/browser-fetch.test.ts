import { afterEach, describe, expect, it, vi } from 'vitest';

const LOOKUP = 'https://itunes.apple.com/lookup?id=1&country=us&entity=software';
const FEED = 'https://itunes.apple.com/us/rss/topfreeapplications/limit=100/json';

// A stand-in for Browser Run: navigating to a download aborts, like Chrome does
// for Apple's lookup API (`Content-Disposition: attachment`).
const visits: string[] = [];
let current = 'about:blank';
const page = {
  url: () => current,
  goto: vi.fn(async (url: string) => {
    visits.push(url);
    if (url.startsWith('https://itunes.apple.com/lookup')) throw new Error(`net::ERR_ABORTED at ${url}`);
    if (url.includes('fail')) throw new Error('Navigation timeout of 60000 ms exceeded');
    current = url;
    return { status: () => 200, headers: () => ({ 'content-type': 'application/json' }), text: async () => `{"page":"${url}"}` };
  }),
  evaluate: vi.fn(async <A, R>(fn: (arg: A) => Promise<R>, arg: A) => fn(arg)),
};
const browser = { newPage: vi.fn(async () => page), close: vi.fn(async () => undefined) };
vi.mock('@cloudflare/puppeteer', () => ({ default: { launch: vi.fn(async () => browser) } }));

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  visits.length = 0;
  current = 'about:blank';
});

describe('Browser Run fetch', () => {
  it('reads a navigation response', async () => {
    const { createBrowserFetch } = await import('../src/browser-fetch.js');
    const bf = createBrowserFetch({} as never);
    const res = await bf.fetch(FEED);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ page: FEED });
    expect(bf.used).toBe(true);
    await bf.close();
    expect(browser.close).toHaveBeenCalled();
  });

  it('reads a download with fetch() from a page on the same origin', async () => {
    const inPage = vi.fn(async (url: string, init?: RequestInit) => {
      expect(init?.credentials).toBe('omit');
      return new Response(`{"results":[{"url":"${url}"}]}`, { headers: { 'content-type': 'text/javascript; charset=utf-8' } });
    });
    vi.stubGlobal('fetch', inPage);
    const { createBrowserFetch } = await import('../src/browser-fetch.js');
    const bf = createBrowserFetch({} as never);

    const res = await bf.fetch(LOOKUP);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    expect(await res.json()).toEqual({ results: [{ url: LOOKUP }] });
    expect(visits).toEqual([LOOKUP, 'https://itunes.apple.com/robots.txt']);

    // Already on the origin: no second detour.
    await bf.fetch(LOOKUP.replace('id=1', 'id=2'));
    expect(visits.filter((v) => v.endsWith('/robots.txt'))).toHaveLength(1);
    expect(inPage).toHaveBeenCalledTimes(2);
    await bf.close();
  });

  it('passes other navigation errors on', async () => {
    const { createBrowserFetch } = await import('../src/browser-fetch.js');
    const bf = createBrowserFetch({} as never);
    await expect(bf.fetch('https://example.com/fail')).rejects.toThrow(/timeout/);
    expect(page.evaluate).not.toHaveBeenCalled();
    await bf.close();
  });
});

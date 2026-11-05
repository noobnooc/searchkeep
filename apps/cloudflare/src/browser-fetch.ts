/**
 * A fetch() for plain GET requests that loads the URL in a Cloudflare Browser
 * Run browser. Bing's Webmaster API refuses the egress IPs of Workers
 * (`ThrottleIP`, often for days) but accepts Browser Run's, so the Bing client
 * uses this as its fallback. The browser opens on first use and serves every
 * call of one request or sync run; call close() when done.
 */
import type { Browser, BrowserWorker, Page } from '@cloudflare/puppeteer';

export interface BrowserFetch {
  fetch: typeof fetch;
  /** True once a browser was opened (it then needs close()). */
  readonly used: boolean;
  close(): Promise<void>;
}

const NAVIGATION_TIMEOUT_MS = 60_000;

export function createBrowserFetch(binding: BrowserWorker): BrowserFetch {
  let browser: Promise<Browser> | null = null;
  let page: Promise<Page> | null = null;
  let queue: Promise<unknown> = Promise.resolve();

  async function load(url: string): Promise<Response> {
    // Loaded on first use only: most requests and runs never need a browser.
    browser ??= import('@cloudflare/puppeteer').then(({ default: puppeteer }) => puppeteer.launch(binding));
    page ??= browser.then((b) => b.newPage());
    const res = await (await page).goto(url, { waitUntil: 'load', timeout: NAVIGATION_TIMEOUT_MS });
    if (!res) throw new Error('Browser Run returned no response');
    return new Response(await res.text(), {
      status: res.status(),
      headers: { 'content-type': res.headers()['content-type'] ?? 'application/octet-stream' },
    });
  }

  const browserFetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (method !== 'GET' || init?.body !== undefined) return Promise.reject(new TypeError('Browser Run fetch supports GET only.'));
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    // One page, one navigation at a time.
    const next = queue.then(() => load(url));
    queue = next.catch(() => undefined);
    return next;
  };

  return {
    fetch: browserFetch as typeof fetch,
    get used() {
      return browser !== null;
    },
    async close() {
      const opened = browser;
      browser = null;
      page = null;
      if (!opened) return;
      const b = await opened.catch(() => null);
      await b?.close().catch(() => undefined);
    },
  };
}

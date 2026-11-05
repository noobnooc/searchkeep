export interface SourceErrorOptions {
  /** The API refused the call because of a rate limit or quota, not because of the request. */
  rateLimited?: boolean;
  /** How long the API asked callers to wait, when it said so. */
  retryAfterMs?: number | null;
}

/** Error from a first-party API, with a message that never contains credentials. */
export class SourceError extends Error {
  readonly rateLimited: boolean;
  readonly retryAfterMs: number | null;

  constructor(
    readonly source: string,
    readonly status: number,
    message: string,
    opts: SourceErrorOptions = {},
  ) {
    super(`${source}: ${message}`);
    this.name = 'SourceError';
    this.rateLimited = opts.rateLimited ?? status === 429;
    this.retryAfterMs = opts.retryAfterMs ?? null;
  }
}

/** True for errors that mean "slow down" (HTTP 429, or an API's own throttling error). */
export function isRateLimited(err: unknown): err is SourceError {
  return err instanceof SourceError && err.rateLimited;
}

export interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  /** Retries for 429 / 5xx / network errors. Default 1. */
  retries?: number;
  fetch?: typeof fetch;
  /** Recognizes an API's own rate-limit errors (some APIs answer 400 instead of 429). */
  rateLimited?: (status: number, body: string) => boolean;
}

/** Longest `Retry-After` worth waiting for inside one request; longer waits are left to the caller. */
const MAX_INLINE_RETRY_MS = 2_000;

/** Parses a `Retry-After` header (seconds or an HTTP date) into milliseconds. */
export function parseRetryAfter(value: string | null, now = Date.now()): number | null {
  if (!value) return null;
  const v = value.trim();
  if (/^\d+$/.test(v)) return Number(v) * 1000;
  const at = Date.parse(v);
  return Number.isNaN(at) ? null : Math.max(0, at - now);
}

/**
 * JSON request with a small retry for transient failures. `source` labels
 * errors; `describe` turns an error body into a short human message.
 */
export async function requestJson<T>(
  source: string,
  url: string,
  opts: RequestOptions = {},
  describe: (status: number, body: string) => string = defaultDescribe,
): Promise<T> {
  const f = opts.fetch ?? fetch;
  const retries = opts.retries ?? 1;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 400 * 2 ** (attempt - 1)));
    let res: Response;
    try {
      res = await f(url, {
        method: opts.method ?? (opts.body === undefined ? 'GET' : 'POST'),
        headers: {
          accept: 'application/json',
          ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...opts.headers,
        },
        ...(opts.body !== undefined ? { body: typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body) } : {}),
      });
    } catch (err) {
      lastErr = new SourceError(source, 0, `network error (${err instanceof Error ? err.name : 'unknown'})`);
      continue;
    }
    const text = await res.text();
    if (res.ok) {
      if (text === '') return undefined as T;
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new SourceError(source, res.status, 'invalid JSON response');
      }
    }
    const rateLimited = res.status === 429 || (opts.rateLimited?.(res.status, text) ?? false);
    const retryAfterMs = parseRetryAfter(res.headers.get('retry-after'));
    lastErr = new SourceError(source, res.status, describe(res.status, text), { rateLimited, retryAfterMs });
    if (rateLimited) {
      // A short 429 is worth one quick retry; anything longer is the caller's to schedule.
      if (res.status === 429 && (retryAfterMs ?? 0) <= MAX_INLINE_RETRY_MS) continue;
      break;
    }
    if (res.status < 500) break;
  }
  throw lastErr;
}

function defaultDescribe(status: number, body: string): string {
  try {
    const j = JSON.parse(body) as Record<string, unknown>;
    const e = j.error as Record<string, unknown> | string | undefined;
    const msg =
      typeof e === 'string'
        ? e
        : ((e?.message as string | undefined) ?? (j.message as string | undefined) ?? (j.Message as string | undefined));
    if (msg) return `HTTP ${status}: ${String(msg).slice(0, 300)}`;
  } catch {
    // not JSON
  }
  return `HTTP ${status}`;
}

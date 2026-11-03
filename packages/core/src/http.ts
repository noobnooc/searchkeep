/** Error from a first-party API, with a message that never contains credentials. */
export class SourceError extends Error {
  constructor(
    readonly source: string,
    readonly status: number,
    message: string,
  ) {
    super(`${source}: ${message}`);
    this.name = 'SourceError';
  }
}

export interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  /** Retries for 429 / 5xx / network errors. Default 1. */
  retries?: number;
  fetch?: typeof fetch;
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
    lastErr = new SourceError(source, res.status, describe(res.status, text));
    if (res.status !== 429 && res.status < 500) break;
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

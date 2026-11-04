/**
 * Thin client for the Worker's same-origin JSON API. Requests carry the
 * Cloudflare Access cookie automatically (same origin); nothing here talks to
 * any other host.
 */
import type { LockedBody } from './types';

export type Params = Record<string, string | number | boolean | null | undefined>;

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

let lockedHandler: ((body: LockedBody) => void) | null = null;

/** Called when any request reports that the deployment is locked. */
export function onLocked(handler: (body: LockedBody) => void): void {
  lockedHandler = handler;
}

/** Builds `/api/...?a=1` with empty values dropped and keys sorted (stable cache keys). */
export function apiUrl(path: string, params: Params = {}): string {
  const qs = new URLSearchParams();
  for (const key of Object.keys(params).sort()) {
    const v = params[key];
    if (v === undefined || v === null || v === '' || v === false) continue;
    qs.set(key, String(v));
  }
  const s = qs.toString();
  return s ? `${path}?${s}` : path;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'DELETE';
  body?: BodyInit;
  contentType?: string;
  signal?: AbortSignal;
}

export async function request<T>(url: string, opts: RequestOptions = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? 'GET',
      credentials: 'same-origin',
      headers: { accept: 'application/json', ...(opts.contentType ? { 'content-type': opts.contentType } : {}) },
      ...(opts.body !== undefined ? { body: opts.body } : {}),
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError(
      0,
      'network',
      'Could not reach Searchkeep. Check your connection, or reload the page if your Cloudflare Access session expired.',
    );
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  const body = (data ?? {}) as { error?: string; code?: string; state?: string };
  if (!res.ok) {
    if (res.status === 403 && body.code === 'locked' && lockedHandler) lockedHandler(body as LockedBody);
    throw new ApiError(res.status, body.code ?? `http_${res.status}`, body.error ?? `Request failed with status ${res.status}.`);
  }
  if (data === null || typeof data !== 'object') {
    throw new ApiError(
      res.status,
      'bad_response',
      'Searchkeep returned an unexpected response. Reload the page; your Access session may have expired.',
    );
  }
  return data as T;
}

// A small response cache so switching between views is instant. Entries are
// replaced by fresh responses in the background (stale-while-revalidate).
const cache = new Map<string, { at: number; data: unknown }>();
const MAX_ENTRIES = 80;

export function cached<T>(url: string): { data: T; fresh: boolean } | null {
  const hit = cache.get(url);
  if (!hit) return null;
  return { data: hit.data as T, fresh: Date.now() - hit.at < 60_000 };
}

export function remember(url: string, data: unknown): void {
  cache.delete(url);
  cache.set(url, { at: Date.now(), data });
  while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!);
}

export function forget(url: string): void {
  cache.delete(url);
}

/** Drops every cached response (see `refreshAll` for live resources). */
export function clearCache(): void {
  cache.clear();
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Something went wrong.';
}

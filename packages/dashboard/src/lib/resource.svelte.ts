import { ApiError, cached, clearCache, forget, remember, request } from './api';

/** Bumped by `refreshAll` so every live resource refetches. */
const epoch = $state({ value: 0 });

/** Clears the response cache and refetches what is on screen (after a sync or import). */
export function refreshAll(): void {
  clearCache();
  epoch.value++;
}

export interface Resource<T> {
  /** Last successful response; kept while a new one loads so the frame stays put. */
  readonly data: T | undefined;
  readonly error: ApiError | undefined;
  /** True while a request is in flight (also when stale data is shown). */
  readonly loading: boolean;
  reload(): void;
}

/**
 * Reactive GET: re-runs whenever the URL returned by `url()` changes. Returns
 * `null` from `url()` to pause. Must be created during component setup.
 */
export function resource<T>(url: () => string | null): Resource<T> {
  let data = $state.raw<T | undefined>(undefined);
  let error = $state.raw<ApiError | undefined>(undefined);
  let loading = $state(true);
  let nonce = $state(0);
  let current: string | null = null;

  $effect(() => {
    const u = url();
    void nonce;
    void epoch.value;
    current = u;
    if (u === null) {
      loading = false;
      return;
    }
    const hit = cached<T>(u);
    if (hit) {
      data = hit.data;
      error = undefined;
      if (hit.fresh) {
        loading = false;
        return;
      }
    }
    const ctrl = new AbortController();
    loading = true;
    request<T>(u, { signal: ctrl.signal })
      .then((d) => {
        if (ctrl.signal.aborted) return;
        remember(u, d);
        data = d;
        error = undefined;
      })
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return;
        error = err instanceof ApiError ? err : new ApiError(0, 'unknown', (err as Error)?.message ?? 'Request failed.');
        data = undefined;
      })
      .finally(() => {
        if (!ctrl.signal.aborted) loading = false;
      });
    return () => ctrl.abort();
  });

  return {
    get data() {
      return data;
    },
    get error() {
      return error;
    },
    get loading() {
      return loading;
    },
    reload() {
      if (current) forget(current);
      nonce++;
    },
  };
}

/**
 * localStorage access that never throws (private windows, blocked storage,
 * quota errors). Only UI preferences are stored here; never data.
 */
const PREFIX = 'searchkeep:';

export function load<T>(key: string, fallback: T, valid?: (v: unknown) => boolean): T {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    if (raw === null) return fallback;
    const v = JSON.parse(raw) as unknown;
    if (valid && !valid(v)) return fallback;
    return v as T;
  } catch {
    return fallback;
  }
}

export function save(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Storage unavailable: the preference lasts for this page view only.
  }
}

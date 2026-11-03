import type { Snippet } from 'svelte';

export type SortDir = 'asc' | 'desc';

export interface SortState {
  key: string;
  dir: SortDir;
}

export interface CellBar {
  value: number;
  max: number;
  /** CSS color; defaults to the accent. */
  color?: string;
}

export interface Column<T> {
  key: string;
  label: string;
  align?: 'left' | 'right';
  /** Display text (defaults to the row's `key` property). */
  text?: (row: T) => string;
  /** Custom cell content. */
  render?: Snippet<[T]>;
  /** Value used for client-side sorting (defaults to the row's `key` property). */
  sortValue?: (row: T) => number | string | null | undefined;
  sortable?: boolean;
  /** Thin inline bar under the value. */
  bar?: (row: T) => CellBar | null;
  /** The column that takes the remaining width (usually a query or page). */
  grow?: boolean;
  width?: string;
  title?: string;
  /** Hidden below 640px. */
  hideOnMobile?: boolean;
}

export function compareValues(a: unknown, b: unknown): number {
  const na = a === null || a === undefined || a === '';
  const nb = b === null || b === undefined || b === '';
  if (na && nb) return 0;
  if (na) return 1;
  if (nb) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'en', { numeric: true, sensitivity: 'base' });
}

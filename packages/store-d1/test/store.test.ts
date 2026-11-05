import { storeContract } from '@searchkeep/core/testing';
import { D1Store } from '../src/store.js';
import { freshD1 } from './helpers.js';

storeContract('D1', async () => new D1Store(await freshD1()));

import { describe, expect, it } from 'vitest';

describe('D1Store.isBusy', () => {
  it('recognizes D1 overload errors, also when Drizzle wraps them', async () => {
    const store = new D1Store(await freshD1());
    const overloaded = new Error('D1_ERROR: D1 DB is overloaded. Too many resources consumed within a 10 second window');
    expect(store.isBusy(overloaded)).toBe(true);
    expect(store.isBusy(new Error('Failed query: update "sync_runs" set ...', { cause: overloaded }))).toBe(true);
    expect(store.isBusy(new Error('D1_ERROR: no such table: nope'))).toBe(false);
    expect(store.isBusy('nothing')).toBe(false);
  });
});

describe('D1Store.setBrandFlags', () => {
  it('looks up each query by id instead of scanning the site once per id', async () => {
    const d1 = await freshD1();
    let rowsRead = 0;
    // Counts the rows D1 reads for each batch (D1 has no planner statistics, so a bad plan shows here).
    const counting = new Proxy(d1, {
      get(target, prop) {
        if (prop === 'batch')
          return async (statements: D1PreparedStatement[]) => {
            const results = await target.batch(statements);
            for (const r of results) rowsRead += r.meta?.rows_read ?? 0;
            return results;
          };
        const v = Reflect.get(target, prop, target) as unknown;
        return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
      },
    });
    const store = new D1Store(counting);
    await store.writeSearchFacts(
      'acme',
      'gsc',
      Array.from({ length: 3_000 }, (_, i) => ({
        date: '2026-10-01',
        kind: 'query_page' as const,
        query: `q${i}`,
        page: '/',
        clicks: 1,
        impressions: 1,
      })),
    );
    const batch = await store.listQueriesForBrandClassification('acme', 'v1', 500);
    rowsRead = 0;
    await store.setBrandFlags(
      'acme',
      'v1',
      batch.map((q, i) => ({ id: q.id, isBrand: i % 2 === 0 })),
    );
    // About one row per id. Joining json_each read every query of the site per id (1.5 million here).
    expect(rowsRead).toBeLessThan(5_000);
    expect(await store.listQueriesForBrandClassification('acme', 'v1', 5_000)).toHaveLength(2_500);
  });
});

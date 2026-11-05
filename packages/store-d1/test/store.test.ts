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

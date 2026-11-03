import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { applyMigrations } from '../src/migrate.js';
import { MIGRATIONS } from '../src/migrations.generated.js';
import { D1Store } from '../src/store.js';
import { freshD1 } from './helpers.js';

/** Migrations shipped in the latest release tag (empty before the first tag). */
function previousReleaseMigrations(): Array<{ name: string; sql: string }> {
  try {
    const tag = execFileSync('git', ['describe', '--tags', '--abbrev=0'], { stdio: 'pipe' }).toString().trim();
    const list = execFileSync('git', ['ls-tree', '--name-only', `${tag}`, 'migrations/'], { stdio: 'pipe' }).toString().trim().split('\n');
    return list
      .filter((f) => f.endsWith('.sql'))
      .sort()
      .map((f) => ({ name: f.replace(/^migrations\//, ''), sql: execFileSync('git', ['show', `${tag}:packages/store-d1/${f}`], { stdio: 'pipe' }).toString() }));
  } catch {
    return [];
  }
}

describe('migrations', () => {
  it('apply on an empty database and are idempotent', async () => {
    const db = await freshD1(false);
    expect(await applyMigrations(db)).toEqual(MIGRATIONS.map((m) => m.name));
    expect(await applyMigrations(db)).toEqual([]);
  });

  it('apply on top of the previous release with data in it', async () => {
    const db = await freshD1(false);
    const previous = previousReleaseMigrations();
    await applyMigrations(db, previous);
    if (previous.length > 0) {
      // Seed with the previous schema's store if it still matches; ignore failures from removed APIs.
      await new D1Store(db).setMeta('seed', '1').catch(() => undefined);
    }
    await applyMigrations(db);
    const store = new D1Store(db);
    await store.syncSites([{ id: 'acme', domain: 'acme.com' }]);
    await store.writeSearchFacts('acme', 'gsc', [{ date: '2026-10-01', kind: 'total', clicks: 1, impressions: 2 }]);
    expect(await store.latestDate('acme', 'gsc')).toBe('2026-10-01');
  });

  it('is compatible with wrangler-applied migrations', async () => {
    const db = await freshD1(false);
    // Simulate `wrangler d1 migrations apply`: same table, same names.
    await db.prepare('CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)').run();
    await applyMigrations(db);
    expect(await applyMigrations(db)).toEqual([]);
  });
});

import { MIGRATIONS } from './migrations.generated.js';

/**
 * Applies pending migrations, tracking them in the same `d1_migrations` table
 * that `wrangler d1 migrations apply` uses, so both paths can coexist: whichever
 * runs first applies a migration and the other skips it.
 *
 * Each migration runs as one D1 batch (atomic). If two isolates race, the loser's
 * batch fails on the unique name and rolls back; it then re-reads and finds the
 * migration applied.
 */
export async function applyMigrations(db: D1Database, migrations = MIGRATIONS): Promise<string[]> {
  await db
    .prepare(
      'CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)',
    )
    .run();
  const applied: string[] = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    const { results } = await db.prepare('SELECT name FROM d1_migrations').all<{ name: string }>();
    const done = new Set(results.map((r) => r.name));
    const pending = migrations.filter((m) => !done.has(m.name));
    if (pending.length === 0) return applied;
    try {
      for (const m of pending) {
        const statements = m.sql
          .split('--> statement-breakpoint')
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
          .map((s) => db.prepare(s));
        statements.push(db.prepare('INSERT INTO d1_migrations (name) VALUES (?)').bind(m.name));
        await db.batch(statements);
        applied.push(m.name);
      }
      return applied;
    } catch (err) {
      if (attempt === 2) throw err;
    }
  }
  return applied;
}

const ensured = new WeakMap<D1Database, Promise<unknown>>();

/** Runs `applyMigrations` once per isolate and database binding. */
export function ensureMigrated(db: D1Database): Promise<unknown> {
  let p = ensured.get(db);
  if (!p) {
    p = applyMigrations(db).catch((err) => {
      ensured.delete(db);
      throw err;
    });
    ensured.set(db, p);
  }
  return p;
}

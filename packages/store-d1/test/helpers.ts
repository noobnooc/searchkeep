import { Miniflare } from 'miniflare';
import { afterAll } from 'vitest';
import { applyMigrations } from '../src/migrate.js';

const instances: Miniflare[] = [];
afterAll(async () => {
  await Promise.all(instances.map((m) => m.dispose()));
});

/** A fresh, empty local D1 database (Miniflare, in memory). */
export async function freshD1(migrate = true): Promise<D1Database> {
  const mf = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response(null) } }',
    d1Databases: { DB: crypto.randomUUID() },
  });
  instances.push(mf);
  const db = (await mf.getD1Database('DB')) as unknown as D1Database;
  if (migrate) await applyMigrations(db);
  return db;
}

// Deploy command for Workers Builds (and local `pnpm run deploy`).
//
// 1. Try to apply D1 migrations remotely. Workers Builds' default build token
//    has no D1 permission, and on the very first deploy the database does not
//    exist yet — both are fine: the Worker applies pending migrations itself on
//    startup, tracking them in the same `d1_migrations` table wrangler uses.
// 2. Deploy (creates the D1 database on the first run).
// 3. If step 1 failed, try the migrations once more now that the DB exists.
import { spawnSync } from 'node:child_process';

function wrangler(args, { allowFailure = false } = {}) {
  const res = spawnSync('npx', ['wrangler', ...args], { stdio: 'inherit', env: { ...process.env, CI: process.env.CI ?? 'true' } });
  if (res.status !== 0 && !allowFailure) process.exit(res.status ?? 1);
  return res.status === 0;
}

const migrate = ['d1', 'migrations', 'apply', 'DB', '--remote'];
let migrated = wrangler(migrate, { allowFailure: true });
if (!migrated)
  console.warn(
    '\n[searchkeep] Remote migration skipped (no D1 permission or database not created yet). Continuing; the Worker migrates on startup.\n',
  );
wrangler(['deploy']);
if (!migrated) {
  migrated = wrangler(migrate, { allowFailure: true });
  if (!migrated) console.warn('\n[searchkeep] Migrations will be applied by the Worker on its first request.\n');
}

// CI guard: (1) the schema has no changes without a migration, (2) the embedded
// copy is current, (3) migration files are never edited once released.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tmp = mkdtempSync(join(tmpdir(), 'searchkeep-migrations-'));
let failed = false;
try {
  cpSync(join(root, 'migrations'), tmp, { recursive: true });
  const before = readdirSync(tmp).filter((f) => f.endsWith('.sql')).length;
  execFileSync('npx', ['drizzle-kit', 'generate', '--dialect', 'sqlite', '--schema', './src/schema.ts', '--out', tmp], { cwd: root, stdio: 'pipe' });
  const after = readdirSync(tmp).filter((f) => f.endsWith('.sql')).length;
  if (after !== before) {
    console.error('Schema changed without a migration. Run: pnpm --filter @searchkeep/store-d1 run db:generate');
    failed = true;
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

try {
  execFileSync('node', [join(root, 'scripts/embed-migrations.mjs'), '--check'], { stdio: 'inherit' });
} catch {
  failed = true;
}

// Released migrations are immutable: compare against the latest tag, if any.
try {
  const tag = execFileSync('git', ['describe', '--tags', '--abbrev=0'], { cwd: root, stdio: 'pipe' }).toString().trim();
  const changed = execFileSync('git', ['diff', '--name-only', '--diff-filter=MDR', tag, '--', 'migrations/*.sql'], { cwd: root, stdio: 'pipe' }).toString().trim();
  if (changed) {
    console.error(`Released migrations were modified since ${tag} (forward-only!):\n${changed}`);
    failed = true;
  }
} catch {
  // No tags yet: nothing released.
}

if (failed) process.exit(1);
console.log('Migrations OK.');

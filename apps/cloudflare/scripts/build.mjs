// Builds the dashboard and copies it into ./public (the Worker's static assets).
import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const app = join(dirname(fileURLToPath(import.meta.url)), '..');
const dashboard = join(app, '../../packages/dashboard');
execSync('pnpm --filter @searchkeep/dashboard run build', { cwd: app, stdio: 'inherit' });
const dist = join(dashboard, 'dist');
if (!existsSync(join(dist, 'index.html'))) throw new Error('Dashboard build produced no index.html');
rmSync(join(app, 'public'), { recursive: true, force: true });
mkdirSync(join(app, 'public'), { recursive: true });
cpSync(dist, join(app, 'public'), { recursive: true });
console.log('Dashboard copied to apps/cloudflare/public');

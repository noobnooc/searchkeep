// CI guard: the Worker bundle must stay well within the Free plan limit (3 MB gzip).
import { execSync } from 'node:child_process';
import { readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const LIMIT = 1.5 * 1024 * 1024; // leave headroom under the 3 MB limit
const out = '.wrangler/size-check';
rmSync(out, { recursive: true, force: true });
execSync(`npx wrangler deploy --dry-run --outdir ${out}`, { stdio: 'inherit' });
let total = 0;
for (const f of readdirSync(out)) {
  const p = join(out, f);
  if (statSync(p).isFile() && /\.(m?js|wasm)$/.test(f)) total += gzipSync(readFileSync(p)).length;
}
const kb = (n) => `${(n / 1024).toFixed(1)} KiB`;
console.log(`Worker bundle (gzip): ${kb(total)} / budget ${kb(LIMIT)}`);
if (total > LIMIT) {
  console.error('Worker bundle exceeds the size budget.');
  process.exit(1);
}

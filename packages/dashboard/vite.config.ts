import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

// `pnpm dev` proxies the API to the local Worker (`wrangler dev`, port 8787 by default).
// Set SEARCHKEEP_API to point elsewhere, e.g. SEARCHKEEP_API=http://localhost:8797.
const api = process.env.SEARCHKEEP_API ?? 'http://localhost:8787';

export default defineConfig({
  plugins: [svelte()],
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: false, target: 'es2022' },
  server: { proxy: { '/api': api, '/mcp': api, '/setup': api } },
});

import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    sveltekit({
      compilerOptions: {
        runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true),
      },
      adapter: adapter({
        pages: 'build',
        assets: 'build',
        strict: true,
      }),
      paths: {
        origin: 'https://searchkeep.dev',
        // 404.html is served for any unknown path, so asset URLs must be root-relative.
        relative: false,
      },
      prerender: {
        entries: ['*', '/404', '/sitemap.xml', '/llms.txt', '/llms-full.txt'],
        handleUnseenRoutes: 'warn',
      },
    }),
  ],
});

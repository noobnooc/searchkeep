/**
 * Architecture guard rails (see AGENTS.md and ADRs 0001/0004).
 * Ambient Cloudflare types (D1Database, Fetcher, …) are kept out of portable
 * packages by their tsconfig (`"types": []`), so typecheck fails if they leak.
 */
const PORTABLE = '^packages/(core|mcp|dashboard|sources)/';

module.exports = {
  forbidden: [
    {
      name: 'packages-not-to-apps',
      comment: 'Dependencies point from apps to packages, never back.',
      severity: 'error',
      from: { path: '^packages/' },
      to: { path: '^apps/' },
    },
    {
      name: 'portable-no-cloudflare',
      comment: 'core, mcp, dashboard and sources must stay platform-agnostic: no Cloudflare/Wrangler/D1 imports.',
      severity: 'error',
      from: { path: PORTABLE, pathNot: '/test/' },
      to: { path: '(@cloudflare/|wrangler|miniflare|drizzle-orm/d1|^cloudflare:)' },
    },
    {
      name: 'portable-no-store',
      comment: 'Only apps choose a Store implementation.',
      severity: 'error',
      from: { path: PORTABLE },
      to: { path: '^packages/store-' },
    },
    {
      name: 'core-no-npm-deps',
      comment: 'core uses Web standard APIs only (tests may use vitest).',
      severity: 'error',
      from: { path: '^packages/core/src/', pathNot: '^packages/core/src/testing/' },
      to: { dependencyTypes: ['npm', 'npm-dev', 'npm-optional', 'npm-peer', 'npm-no-pkg', 'npm-unknown'] },
    },
    {
      name: 'core-no-workspace-deps',
      comment: 'core depends on nothing else in the workspace.',
      severity: 'error',
      from: { path: '^packages/core/' },
      to: { path: '^packages/(?!core/)' },
    },
    {
      name: 'mcp-only-core',
      comment: 'MCP tools call core only — never sources or stores directly.',
      severity: 'error',
      from: { path: '^packages/mcp/src/' },
      to: { path: '^packages/(sources|store-|dashboard)' },
    },
    {
      name: 'no-unresolvable',
      comment: 'Every import must resolve — catches dependencies missing from package.json.',
      severity: 'error',
      from: {},
      to: { couldNotResolve: true, pathNot: '^(cloudflare:|virtual:)' },
    },
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(node_modules|dist|public|build|\\.svelte-kit|\\.wrangler|migrations\\.generated)' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.base.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'types', 'default'],
      extensions: ['.ts', '.js', '.svelte'],
    },
    combinedDependencies: true,
  },
};

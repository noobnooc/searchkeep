export interface TocItem {
  id: string;
  title: string;
  level?: 2 | 3;
}

export interface DocPage {
  path: string;
  title: string;
  /** Short label for the sidebar; defaults to title. */
  nav?: string;
  description: string;
  toc: TocItem[];
}

export interface DocSection {
  title: string;
  pages: DocPage[];
}

export const DOCS: DocSection[] = [
  {
    title: 'Getting started',
    pages: [
      {
        path: '/docs',
        title: 'Introduction',
        description:
          'What Searchkeep is, how it works, what it deliberately does not do, and what you need to run it in your own Cloudflare account.',
        toc: [
          { id: 'what-it-is', title: 'What Searchkeep is' },
          { id: 'how-it-works', title: 'How it works' },
          { id: 'what-you-get', title: 'What you get' },
          { id: 'not-doing', title: 'What it does not do' },
          { id: 'requirements', title: 'Requirements' },
          { id: 'next-steps', title: 'Next steps' },
        ],
      },
      {
        path: '/docs/deploy',
        title: 'Deploy',
        description:
          'Step-by-step guide to deploying Searchkeep to your Cloudflare account with a GitHub fork and Workers Builds, including Access, credentials and verification.',
        toc: [
          { id: 'overview', title: 'Overview' },
          { id: 'before-you-start', title: 'Before you start' },
          { id: 'fork', title: '1. Fork the repository' },
          { id: 'github-app', title: '2. Authorize the GitHub App' },
          { id: 'workers-builds', title: '3. Create the Worker' },
          { id: 'database', title: '4. First build creates D1' },
          { id: 'domain', title: '5. Add a custom domain' },
          { id: 'access', title: '6. Protect it with Access' },
          { id: 'credentials', title: '7. Add credentials' },
          { id: 'cred-cloudflare', title: 'Cloudflare', level: 3 },
          { id: 'cred-sites', title: 'Sites', level: 3 },
          { id: 'cred-gsc', title: 'Google Search Console', level: 3 },
          { id: 'cred-bing', title: 'Bing Webmaster Tools', level: 3 },
          { id: 'cred-optional', title: 'Optional settings', level: 3 },
          { id: 'verify', title: '8. Verify and sync' },
          { id: 'with-an-agent', title: 'Deploy with an agent' },
          { id: 'troubleshooting', title: 'Troubleshooting' },
        ],
      },
      {
        path: '/docs/configuration',
        title: 'Configuration',
        description:
          'Every Worker Secret Searchkeep reads, the SITES JSON format, brand regex, write access, sync budgets, how to set secrets with wrangler or the dashboard, and local development.',
        toc: [
          { id: 'where-config-lives', title: 'Where configuration lives' },
          { id: 'secrets', title: 'Secrets reference' },
          { id: 'sites', title: 'SITES' },
          { id: 'brand', title: 'Brand and non-brand' },
          { id: 'writes', title: 'Enabling writes' },
          { id: 'sync-budgets', title: 'Sync budgets' },
          { id: 'setting', title: 'Setting and rotating secrets' },
          { id: 'local', title: 'Local development' },
        ],
      },
    ],
  },
  {
    title: 'Using Searchkeep',
    pages: [
      {
        path: '/docs/mcp',
        title: 'MCP server',
        nav: 'MCP server & tools',
        description:
          'Connect Claude, Claude Code, Cursor, ChatGPT or any MCP client to your Searchkeep endpoint, and the full reference for every tool, its parameters and defaults.',
        toc: [
          { id: 'endpoint', title: 'Endpoint and auth' },
          { id: 'connect', title: 'Connect a client' },
          { id: 'claude', title: 'Claude', level: 3 },
          { id: 'claude-code', title: 'Claude Code', level: 3 },
          { id: 'cursor', title: 'Cursor', level: 3 },
          { id: 'chatgpt', title: 'ChatGPT', level: 3 },
          { id: 'other-clients', title: 'Other clients', level: 3 },
          { id: 'common-parameters', title: 'Common parameters' },
          { id: 'tools', title: 'Tool reference' },
          { id: 'questions', title: 'Questions to try' },
        ],
      },
      {
        path: '/docs/data-sources',
        title: 'Data sources',
        description:
          'What Searchkeep pulls from Google Search Console, Bing Webmaster Tools and Cloudflare, the credentials each needs, how syncing works, how AI citations are imported and every known limitation.',
        toc: [
          { id: 'overview', title: 'Overview' },
          { id: 'sync', title: 'How syncing works' },
          { id: 'gsc', title: 'Google Search Console' },
          { id: 'bing', title: 'Bing Webmaster Tools' },
          { id: 'cloudflare', title: 'Cloudflare' },
          { id: 'ai-citations', title: 'Importing AI citations' },
          { id: 'geo-funnel', title: 'How the GEO funnel is built' },
          { id: 'caveats', title: 'Reading the numbers' },
        ],
      },
      {
        path: '/docs/security',
        title: 'Security',
        description:
          'How Searchkeep is protected: Cloudflare Access, Managed OAuth for MCP clients, JWT re-verification on every request, readiness states and locking until ready.',
        toc: [
          { id: 'model', title: 'Security model' },
          { id: 'access', title: 'Cloudflare Access' },
          { id: 'oauth', title: 'Managed OAuth for MCP' },
          { id: 'jwt', title: 'JWT re-verification' },
          { id: 'readiness', title: 'Readiness states' },
          { id: 'public', title: 'Public endpoints' },
          { id: 'credentials', title: 'Credentials' },
          { id: 'reporting', title: 'Reporting a vulnerability' },
        ],
      },
    ],
  },
  {
    title: 'Project',
    pages: [
      {
        path: '/docs/architecture',
        title: 'Architecture',
        description:
          'One Worker, three entrances: how MCP, the dashboard and the cron share one core and one D1 database, the package layout and the extension points.',
        toc: [
          { id: 'overview', title: 'Overview' },
          { id: 'requests', title: 'Request flow' },
          { id: 'packages', title: 'Packages' },
          { id: 'data', title: 'Data model' },
          { id: 'extension-points', title: 'Extension points' },
          { id: 'principles', title: 'Principles' },
          { id: 'decisions', title: 'Key decisions' },
        ],
      },
      {
        path: '/docs/upgrading',
        title: 'Upgrading',
        description:
          'Upgrade Searchkeep by syncing your fork. What happens during an upgrade, how migrations work, manual steps and rolling back.',
        toc: [
          { id: 'sync-fork', title: 'Sync your fork' },
          { id: 'what-happens', title: 'What happens next' },
          { id: 'migrations', title: 'Database migrations' },
          { id: 'manual-steps', title: 'Releases with manual steps' },
          { id: 'rollback', title: 'Rolling back' },
          { id: 'customizing', title: 'If you changed the code' },
        ],
      },
      {
        path: '/docs/faq',
        title: 'FAQ',
        description: 'Frequently asked questions about Searchkeep: cost, data ownership, GEO, history, AI clients and upgrades.',
        toc: [{ id: 'questions', title: 'Questions' }],
      },
    ],
  },
];

export const DOC_PAGES: DocPage[] = DOCS.flatMap((s) => s.pages);

export function findDoc(path: string): DocPage | undefined {
  const clean = path.length > 1 ? path.replace(/\/$/, '') : path;
  return DOC_PAGES.find((p) => p.path === clean);
}

export function neighbours(path: string): { prev?: DocPage; next?: DocPage } {
  const i = DOC_PAGES.findIndex((p) => p.path === path);
  if (i < 0) return {};
  return { prev: DOC_PAGES[i - 1], next: DOC_PAGES[i + 1] };
}

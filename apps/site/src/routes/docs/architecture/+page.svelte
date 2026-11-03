<script lang="ts">
  import ArchitectureDiagram from '#lib/components/visuals/ArchitectureDiagram.svelte';
  import CodeBlock from '#lib/components/CodeBlock.svelte';

  const tree = `searchkeep/
├─ apps/
│  ├─ cloudflare/       Worker entry (Hono) + wrangler.jsonc   @searchkeep/cloudflare
│  └─ site/             This website (SvelteKit)               @searchkeep/site
├─ packages/
│  ├─ core/             Domain model, analysis, Store/Auth/Source interfaces
│  ├─ store-d1/         Drizzle schema, D1 migrations, Store on D1
│  ├─ mcp/              MCP tool definitions (call core only)
│  ├─ dashboard/        Dashboard UI (Svelte + Vite single-page app)
│  └─ sources/
│     ├─ gsc/           @searchkeep/source-gsc
│     ├─ bing/          @searchkeep/source-bing
│     └─ cloudflare/    @searchkeep/source-cloudflare
├─ docs/                charter, ADRs, roadmap, deploy runbook
└─ AGENTS.md            instructions for AI agents working on the repo`;

  const extension = [
    { iface: 'Store', now: 'store-d1 (Drizzle, D1)', later: 'store-pg: same interface, same test suite' },
    { iface: 'Auth', now: 'Cloudflare Access JWT', later: 'Any OIDC proxy, e.g. oauth2-proxy or Pomerium' },
    { iface: 'Scheduler', now: 'Cron Trigger → core.runSync()', later: 'Vercel Cron, node-cron calling the same function' },
    { iface: 'Runtime entry', now: 'apps/cloudflare', later: 'apps/node (Docker), Vercel' },
    { iface: 'Source', now: 'GSC, Bing, Cloudflare', later: 'More first-party sources' },
    { iface: 'Config', now: 'Worker Secrets', later: 'Environment variables' },
  ];
</script>

<h2 id="overview">Overview</h2>
<p>
  You deploy exactly one Worker. MCP, the dashboard and the daily sync are three entrances to it. They share one core
  library and one D1 database, so there is only one place where numbers are computed.
</p>
<ArchitectureDiagram />

<h2 id="requests">Request flow</h2>
<ol>
  <li>
    <strong>MCP</strong> requests to <code>/mcp</code> and <strong>dashboard</strong> requests to <code>/</code> and
    <code>/api/*</code> hit Cloudflare Access first, which authenticates the person (cookie for the browser, OAuth for MCP
    clients) and attaches a signed JWT.
  </li>
  <li>The Worker, built on Hono, verifies the JWT and computes the readiness state before routing.</li>
  <li>
    The <strong>MCP</strong> entrance is a stateless Streamable HTTP server built with the official TypeScript SDK; the
    <strong>dashboard</strong> is a static single-page app served from Worker assets that talks to <code>/api</code>.
  </li>
  <li>The <strong>cron</strong> entrance (<code>scheduled()</code>) is invoked internally by Cloudflare and calls <code>core.runSync()</code>.</li>
  <li>
    All three call <strong>core</strong>. Core reads and writes data only through the <strong>Store</strong> interface and
    calls external APIs only through <strong>Source</strong> adapters.
  </li>
</ol>

<h2 id="packages">Packages</h2>
<p>
  The repository is a pnpm workspace. <code>apps/</code> holds deployable entry points; <code>packages/</code> holds
  reusable libraries. Dependencies only point from apps to packages, and core depends on no platform.
</p>
<CodeBlock lang="text" title="Repository layout" code={tree} copy={false} />
<ul>
  <li>
    <strong>core</strong> uses only Web-standard APIs (<code>fetch</code>, <code>Request</code>/<code>Response</code>,
    WebCrypto). No Cloudflare binding types appear in core, mcp, dashboard or the sources; a dependency-cruiser rule in
    CI enforces it.
  </li>
  <li><strong>store-d1</strong> is the only place with SQL. Core calls Store methods, never queries.</li>
  <li>
    <strong>mcp</strong> and <strong>dashboard</strong> are separate packages so a future runtime entry can reuse them
    unchanged.
  </li>
</ul>

<h2 id="data">Data model</h2>
<p>
  Each source writes to its own raw tables, which are then folded into a unified fact table: date, source, page, query
  and metrics. Analysis reads only the fact table and a few dimension tables, which is what makes cross-source views
  such as the GEO funnel straightforward.
</p>
<ul>
  <li>Dates are UTC calendar dates.</li>
  <li>Positions are stored as impression-weighted sums so they re-aggregate exactly across days, pages and queries.</li>
  <li>Site-wide daily totals are stored separately from query × page rows, so anonymized queries do not distort totals.</li>
  <li>Migrations are generated with drizzle-kit and are forward-only.</li>
</ul>
<p>
  There are no Durable Objects, which are the hardest primitive to port. Short-lived API access tokens are cached in
  memory per isolate.
</p>

<h2 id="extension-points">Extension points</h2>
<p>
  Version 0.1 ships Cloudflare implementations only, but every platform-specific capability sits behind an interface.
  Adding a platform means adding an implementation, not changing core.
</p>
<div class="table-wrap">
  <table>
    <thead><tr><th>Interface</th><th>Today</th><th>Later</th></tr></thead>
    <tbody>
      {#each extension as e (e.iface)}
        <tr><td>{e.iface}</td><td>{e.now}</td><td>{e.later}</td></tr>
      {/each}
    </tbody>
  </table>
</div>
<p>
  Store implementations are verified by one shared test suite that runs against a local D1 today; a Postgres
  implementation is done when it passes the same suite.
</p>

<h2 id="principles">Principles</h2>
<p>From the project charter, in priority order. When two conflict, the earlier one wins.</p>
<ol>
  <li>User data stays in the user’s own account: no telemetry, no callbacks, no dependency on the project’s servers.</li>
  <li>Only first-party data the site owner has access to: no backlinks, competitors or rank scraping.</li>
  <li>Self-hosted with zero operations: runs on free tiers, upgrades with “Sync fork”.</li>
  <li>Read-only by default: any write to an external system must be explicitly enabled.</li>
  <li>Core is platform-agnostic; platform capabilities live behind interfaces.</li>
  <li>Docs are written for agents to execute: every step repeatable and verifiable.</li>
  <li>Few dependencies: if a Web-standard API can do it, no library is added.</li>
</ol>

<h2 id="decisions">Key decisions</h2>
<p>Recorded as ADRs in <code>docs/adr/</code>, because these are the choices most likely to be “helpfully” reverted:</p>
<ul>
  <li><strong>One Worker, three entrances</strong> rather than separate services.</li>
  <li><strong>No Durable Objects</strong>, to keep the core portable.</li>
  <li><strong>Cloudflare Access for authentication</strong>, with no auth code in the app.</li>
  <li><strong>Drizzle behind a Store interface</strong>, so databases are swappable.</li>
  <li><strong>Fork + Workers Builds</strong> for deploys and upgrades, instead of a deploy button.</li>
  <li>
    <strong>Discrete MCP tools rather than Code Mode.</strong> Thirteen tools fit comfortably in context; each can be
    annotated read-only or write so clients can auto-approve reads and confirm the one write; and it needs no sandbox.
    Tools aggregate on the server and cap their output, which keeps responses small.
  </li>
  <li><strong>Agent maintenance only through GitHub issues and pull requests</strong>, with humans merging and tagging releases.</li>
</ul>

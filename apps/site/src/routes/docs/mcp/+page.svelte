<script lang="ts">
  import Callout from '#lib/components/Callout.svelte';
  import CodeBlock from '#lib/components/CodeBlock.svelte';
  import { TOOLS } from '#lib/content.ts';

  const md = (s: string) =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/`([^`]+)`/g, '<code>$1</code>');

  const claudeCode = `claude mcp add --transport http searchkeep https://searchkeep.example.com/mcp`;
  const cursor = `{
  "mcpServers": {
    "searchkeep": {
      "url": "https://searchkeep.example.com/mcp"
    }
  }
}`;
  const remote = `{
  "mcpServers": {
    "searchkeep": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://searchkeep.example.com/mcp"]
    }
  }
}`;
  const example = `{
  "name": "find_quick_wins",
  "arguments": {
    "site": "acme",
    "start": "2026-08-01",
    "end": "2026-10-31",
    "brand": "non_brand",
    "limit": 10
  }
}`;

  const questions = [
    'Which pages do AI crawlers hit but never get cited?',
    'Compare non-brand clicks this October with last October, by page.',
    'Which of our pages compete with each other for the same queries?',
    'Find queries where our CTR is far below what our position should give us.',
    'Which docs pages have been losing clicks for the last three months, and why?',
    'Is any AI crawler getting 404s or 5xx from us? Group by crawler and path.',
    'Inspect https://acme.com/pricing in Google and tell me if it is indexed.',
    'Which of our sitemap pages are not indexed, and why? Any structured data errors?',
    'How often did Googlebot crawl us this week, and which pages answered 404?',
    'Which pages get traffic from Google Discover or image search?',
    'Which pages get the most visits from AI assistants, and do they also rank in search?',
  ];
</script>

<h2 id="endpoint">Endpoint and auth</h2>
<p>Your Searchkeep deployment is an MCP server at:</p>
<CodeBlock lang="text" title="MCP endpoint" code="https://searchkeep.example.com/mcp" />
<ul>
  <li>
    <strong>Transport:</strong> Streamable HTTP, stateless. There are no long-lived sessions to keep alive, so it works
    well with Workers and with clients that reconnect often.
  </li>
  <li>
    <strong>Auth:</strong> OAuth 2.1, provided by Cloudflare Access’s Managed OAuth. Clients discover the authorization
    server, register themselves dynamically and use PKCE. You never paste a client ID or token: the client opens a
    browser, you sign in to Access, and it is connected.
  </li>
  <li>
    <strong>Readiness:</strong> until your deployment is <code>ready</code> (see
    <a href="/docs/security#readiness">Security</a>), <code>/mcp</code> returns a JSON-RPC error (HTTP 403) that explains
    why it is locked and what to fix, instead of serving tools.
  </li>
</ul>

<h2 id="connect">Connect a client</h2>
<p>
  Replace <code>searchkeep.example.com</code> with your own custom domain. Menu names in AI clients change often; if a
  label below has moved, look for “connectors” or “MCP servers”.
</p>

<h3 id="claude">Claude</h3>
<ol>
  <li>In Claude (web or desktop), open <strong>Settings → Connectors</strong> and choose <strong>Add custom connector</strong>.</li>
  <li>Name it <code>Searchkeep</code> and enter your <code>/mcp</code> URL.</li>
  <li>Click <strong>Connect</strong>, sign in to Cloudflare Access in the browser window that opens, and approve.</li>
  <li>In a chat, enable the Searchkeep connector from the tools menu and ask a question.</li>
</ol>

<h3 id="claude-code">Claude Code</h3>
<CodeBlock lang="bash" code={claudeCode} />
<p>
  Then run <code>/mcp</code> inside Claude Code, select <strong>searchkeep</strong> and authenticate. Add
  <code>--scope user</code> to make it available in every project, or <code>--scope project</code> to share it with your
  team through <code>.mcp.json</code> (each person still signs in with their own Access identity).
</p>

<h3 id="cursor">Cursor</h3>
<p>Add the server to <code>~/.cursor/mcp.json</code> (all projects) or <code>.cursor/mcp.json</code> (one project):</p>
<CodeBlock lang="json" title="mcp.json" code={cursor} />
<p>Cursor detects that the server needs OAuth and shows a <strong>Login</strong> button in its MCP settings.</p>

<h3 id="chatgpt">ChatGPT</h3>
<ol>
  <li>In ChatGPT settings, open <strong>Apps &amp; Connectors</strong> and turn on <strong>Developer mode</strong> under advanced settings.</li>
  <li>Create a connector with your <code>/mcp</code> URL and <strong>OAuth</strong> authentication.</li>
  <li>Sign in to Cloudflare Access when prompted, then enable the connector in a chat.</li>
</ol>

<h3 id="other-clients">Other clients</h3>
<p>
  Any client that speaks Streamable HTTP with OAuth works directly. For a client that only supports local
  (stdio) servers, bridge it with <code>mcp-remote</code>, which handles the OAuth flow for you:
</p>
<CodeBlock lang="json" title="stdio bridge" code={remote} />

<Callout kind="note" title="Who can connect">
  <p>
    Exactly the people your Access policy allows. Each MCP client acts as the person who signed in, and every request
    is checked against your Access application’s AUD tag.
  </p>
</Callout>

<h2 id="common-parameters">Common parameters</h2>
<p>
  Most tools share these parameters; parameter names are camelCase. All are optional unless a tool marks them
  required.
</p>
<div class="table-wrap">
  <table>
    <thead><tr><th>Parameter</th><th>Type</th><th>Meaning</th></tr></thead>
    <tbody>
      <tr><td><code>site</code></td><td><code>string</code></td><td>Site <code>id</code> or domain from <code>SITES</code>. May be omitted when only one site is configured.</td></tr>
      <tr><td><code>start</code>, <code>end</code></td><td><code>YYYY-MM-DD</code></td><td>Inclusive UTC date range. <code>end</code> defaults to the latest day with data, <code>start</code> to <code>end</code> minus <code>days</code> plus one.</td></tr>
      <tr><td><code>days</code></td><td><code>number</code></td><td>Window length when <code>start</code> is omitted. Defaults to 28 (7 for <code>ai_crawlers</code> and <code>search_crawlers</code>).</td></tr>
      <tr><td><code>source</code></td><td><code>"gsc" | "bing"</code></td><td>Search engine for search-performance tools. Defaults to <code>gsc</code>. Bing data is weekly, so Bing ranges are aligned to whole weeks.</td></tr>
      <tr><td><code>searchType</code></td><td><code>"web" | "image" | "video" | "news" | "discover" | "googleNews"</code></td><td>Search Console search type for search-performance tools. Defaults to <code>web</code>. Discover and Google News report pages only.</td></tr>
      <tr><td><code>brand</code></td><td><code>"all" | "brand" | "non_brand"</code></td><td>Brand split using the configured brand regex. Defaults to <code>all</code>.</td></tr>
      <tr><td><code>limit</code></td><td><code>number</code></td><td>Maximum rows returned (at most 500). Results are aggregated on the server and capped.</td></tr>
    </tbody>
  </table>
</div>
<p>A call looks like this:</p>
<CodeBlock lang="json" title="tools/call" code={example} />

<h2 id="tools">Tool reference</h2>
<p>
  All tools are read-only and annotated as such, except <code>submit_sitemap</code>, which is not registered unless you
  <a href="/docs/configuration#writes">enable writes</a>. Tools read from D1 unless noted (<code>inspect_url</code>,
  <code>list_sitemaps</code> with <code>live</code>, and the probes of <code>setup_status</code> call the source APIs),
  so they are fast and do not spend your API quotas. Every result is JSON; errors come back as
  <code>{'{"error": "…"}'}</code> with an explanation.
</p>

{#each TOOLS as t (t.name)}
  <section class="tool" id={t.name} aria-labelledby="{t.name}-title">
    <div class="tool-head">
      <h3 id="{t.name}-title"><code>{t.name}</code></h3>
      <span class="tag" class:write={!t.readOnly}>{t.readOnly ? 'read-only' : 'write · off by default'}</span>
    </div>
    <p>{@html md(t.description)}</p>
    {#if t.params.length}
      <div class="table-wrap">
        <table>
          <thead><tr><th>Parameter</th><th>Type</th><th>Description</th></tr></thead>
          <tbody>
            {#each t.params as p (p.name)}
              <tr>
                <td><code>{p.name}</code>{#if p.required}<span class="reqd">required</span>{/if}</td>
                <td><code class="type">{p.type}</code></td>
                <td>{@html md(p.description)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {:else}
      <p class="noparams">No parameters.</p>
    {/if}
    {#if t.example}
      <p class="try"><span>Try</span> “{t.example}”</p>
    {/if}
  </section>
{/each}

<h2 id="questions">Questions to try</h2>
<p>You do not need to name tools; the assistant picks them. A few good starting points:</p>
<ul>
  {#each questions as q (q)}
    <li>{q}</li>
  {/each}
</ul>

<style>
  .tool {
    margin-top: 2.2em;
    padding-top: 1.6em;
    border-top: 1px solid var(--line);
  }
  .tool > * + * {
    margin-top: 0.9em;
  }
  .tool-head {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px 12px;
  }
  .tool-head h3 {
    margin: 0;
  }
  .tool-head h3 code {
    font-size: 1.0625rem;
    padding: 0.15em 0.45em;
    background: var(--surface-2);
  }
  .tag {
    font-size: var(--fs-xs);
    font-weight: 550;
    padding: 2px 8px;
    border-radius: 6px;
    color: var(--accent);
    background: var(--accent-soft);
  }
  .tag.write {
    color: var(--warn);
    background: var(--warn-soft);
  }
  .reqd {
    display: block;
    margin-top: 2px;
    font-size: 11px;
    color: var(--warn);
  }
  td code {
    white-space: nowrap;
  }
  td code.type {
    white-space: normal;
    padding: 0;
    border: 0;
    background: none;
    color: var(--text-2);
    font-size: 0.8rem;
  }
  .noparams {
    font-size: var(--fs-sm);
    color: var(--text-3);
  }
  .try {
    font-size: var(--fs-sm);
    color: var(--text-2);
  }
  .try span {
    margin-right: 6px;
    font-size: var(--fs-xs);
    font-weight: 600;
    color: var(--text-4);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
</style>

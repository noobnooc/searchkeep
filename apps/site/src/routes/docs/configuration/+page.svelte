<script lang="ts">
  import Callout from '#lib/components/Callout.svelte';
  import CodeBlock from '#lib/components/CodeBlock.svelte';
  import { SECRETS, SITE_FIELDS, SITES_EXAMPLE } from '#lib/content.ts';

  const md = (s: string) =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/`([^`]+)`/g, '<code>$1</code>');

  const multiSite = `[
  { "id": "acme", "domain": "acme.com", "gscProperty": "sc-domain:acme.com",
    "bingSiteUrl": "https://acme.com/", "cloudflareZoneId": "023e105f4ecef8ad9ca31a8372d0c353",
    "webAnalyticsSiteTag": "abc123", "brandRegex": "acme" },
  { "id": "acme-docs", "domain": "docs.acme.com", "gscProperty": "https://docs.acme.com/",
    "webAnalyticsSiteTag": "def456" }
]`;

  const devVars = `# apps/cloudflare/.dev.vars — git-ignored, never commit it
CLOUDFLARE_ACCOUNT_ID=023e105f4ecef8ad9ca31a8372d0c353
CLOUDFLARE_API_TOKEN=...
SITES=[{"id":"acme","domain":"acme.com","gscProperty":"sc-domain:acme.com"}]`;

  const rotate = `# Overwrite a secret with a new value; it applies to the next request.
npx wrangler secret put BING_API_KEY --name searchkeep

# List which secrets exist (names only, never values).
npx wrangler secret list --name searchkeep

# Remove one.
npx wrangler secret delete ENABLE_WRITES --name searchkeep`;
</script>

<h2 id="where-config-lives">Where configuration lives</h2>
<p>
  All configuration is stored as <strong>Worker Secrets</strong> on your <code>searchkeep</code> Worker. None of it is
  in the repository, which is what lets your fork stay identical to upstream and upgrade with “Sync fork”.
</p>
<ul>
  <li>
    Secrets are encrypted, never shown again after you set them, and never printed in logs by Searchkeep.
    <code>setup_status</code> reports only whether each one is present.
  </li>
  <li>
    The repository’s <code>wrangler.jsonc</code> sets <code>keep_vars: true</code>, so if you prefer to keep a
    non-sensitive value such as <code>BRAND_REGEX</code> as a plain variable in the dashboard, deployments will not
    overwrite it.
  </li>
  <li>Changes apply on the next request. There is nothing to redeploy.</li>
</ul>

<h2 id="secrets">Secrets reference</h2>
<div class="table-wrap">
  <table>
    <thead><tr><th>Name</th><th>Required</th><th>Description</th></tr></thead>
    <tbody>
      {#each SECRETS as s (s.name)}
        <tr>
          <td><code>{s.name}</code></td>
          <td><span class="req" class:yes={s.required === 'yes'}>{s.required}</span></td>
          <td>
            {@html md(s.description)}
            {#if s.example}<div class="ex">e.g. <code>{s.example}</code></div>{/if}
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<h2 id="sites">SITES</h2>
<p>
  <code>SITES</code> is a JSON array with one object per site. It maps the site to its identifier in each data source;
  every source-specific field is optional, and a source is simply skipped for a site that does not set it.
</p>
<CodeBlock lang="json" title="SITES" code={SITES_EXAMPLE} />
<div class="table-wrap">
  <table>
    <thead><tr><th>Field</th><th>Required</th><th>Description</th></tr></thead>
    <tbody>
      {#each SITE_FIELDS as f (f.name)}
        <tr>
          <td><code>{f.name}</code></td>
          <td><span class="req" class:yes={f.required}>{f.required ? 'yes' : 'no'}</span></td>
          <td>{@html md(f.description)}</td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>
<p>Several sites, with different sources each, look like this:</p>
<CodeBlock lang="json" title="SITES" code={multiSite} />
<h3 id="finding-ids">Where to find each identifier</h3>
<ul>
  <li><strong>gscProperty</strong>: the property selector in Search Console. Domain properties are written <code>sc-domain:example.com</code>; URL-prefix properties are the full URL with a trailing slash.</li>
  <li><strong>bingSiteUrl</strong>: the site URL exactly as listed in Bing Webmaster Tools.</li>
  <li><strong>cloudflareZoneId</strong>: the zone’s <strong>Overview</strong> page in the Cloudflare dashboard, under API.</li>
  <li><strong>webAnalyticsSiteTag</strong>: <strong>Analytics &amp; Logs → Web Analytics</strong>, then the site’s settings; it is the <code>token</code>/site tag shown in the JS snippet.</li>
</ul>
<Callout kind="note" title="Changing a site id">
  <p>
    The <code>id</code> keys the site’s history in D1. Changing it later makes Searchkeep treat the site as new. Pick
    something stable.
  </p>
</Callout>

<h2 id="brand">Brand and non-brand</h2>
<p>
  Every query-level tool and dashboard view accepts <code>brand: "all" | "brand" | "non_brand"</code>. A query counts
  as brand when it matches the site’s <code>brandRegex</code>, or <code>BRAND_REGEX</code> if the site has none. Both
  are JavaScript regular expression sources, matched case-insensitively against the full query text.
</p>
<CodeBlock lang="regex" title="BRAND_REGEX" code={'acme|acme\\s?corp|acmeapp'} copy={false} />
<ul>
  <li>Do not wrap the pattern in slashes and do not add flags.</li>
  <li>Include common misspellings and the product names people search for.</li>
  <li>If neither is set, every query is non-brand and the <code>brand</code> filter has no effect.</li>
</ul>

<h2 id="writes">Enabling writes</h2>
<p>
  Searchkeep is read-only by default. The only tool that changes anything outside your account,
  <code>submit_sitemap</code>, is not even registered with MCP clients until you opt in:
</p>
<ol>
  <li>Set <code>ENABLE_WRITES</code> to <code>true</code>.</li>
  <li>
    In Search Console, change the service account’s permission on the property from <strong>Restricted</strong> to
    <strong>Full</strong>. Submitting sitemaps requires it.
  </li>
</ol>
<p>
  The tool is annotated as a write, so well-behaved MCP clients ask before running it even when you have auto-approved
  the read-only tools. Remove the secret to turn writes off again.
</p>

<h2 id="setting">Setting and rotating secrets</h2>
<p>
  Use <code>npx wrangler</code> from any directory (it does not need a clone of the repository), or the dashboard:
  <strong>Workers &amp; Pages → searchkeep → Settings → Variables and Secrets → Add</strong>, with type
  <strong>Secret</strong>.
</p>
<CodeBlock lang="bash" code={rotate} />
<p>
  To rotate a credential, create the new one at the source, overwrite the secret, confirm <code>setup_status</code> is
  still green, then revoke the old credential at the source.
</p>

<h2 id="local">Local development</h2>
<p>
  For working on Searchkeep itself, <code>pnpm dev</code> at the repository root starts the Worker locally with
  <code>wrangler dev</code>. Local secrets go in <code>apps/cloudflare/.dev.vars</code>, which is git-ignored, and the
  local D1 is migrated with <code>pnpm --filter @searchkeep/cloudflare run db:migrate:local</code>.
</p>
<CodeBlock lang="bash" title=".dev.vars" code={devVars} />
<p>
  The repository’s <code>CONTRIBUTING.md</code> and <code>AGENTS.md</code> describe the full local workflow, including
  tests and how Access is handled when there is no Access in front of <code>localhost</code>.
</p>

<style>
  .req {
    display: inline-block;
    padding: 1px 7px;
    border-radius: 6px;
    font-size: var(--fs-xs);
    font-weight: 550;
    white-space: nowrap;
    color: var(--text-3);
    background: var(--surface-2);
  }
  .req.yes {
    color: var(--accent);
    background: var(--accent-soft);
  }
  .ex {
    margin-top: 4px;
    font-size: var(--fs-xs);
    color: var(--text-4);
  }
  td code {
    white-space: nowrap;
  }
  td .ex code {
    white-space: normal;
    word-break: break-all;
  }
</style>

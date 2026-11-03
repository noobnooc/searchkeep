<script lang="ts">
  import { GITHUB, SITE } from '../site';
  import Logo from './Logo.svelte';

  const columns = [
    {
      title: 'Product',
      links: [
        { href: '/#funnel', label: 'GEO funnel' },
        { href: '/#mcp', label: 'MCP tools' },
        { href: '/#dashboard', label: 'Dashboard' },
        { href: '/#history', label: 'Long-term history' },
        { href: '/changelog', label: 'Changelog' },
      ],
    },
    {
      title: 'Docs',
      links: [
        { href: '/docs', label: 'Introduction' },
        { href: '/docs/deploy', label: 'Deploy' },
        { href: '/docs/configuration', label: 'Configuration' },
        { href: '/docs/mcp', label: 'MCP server' },
        { href: '/docs/data-sources', label: 'Data sources' },
      ],
    },
    {
      title: 'Project',
      links: [
        { href: '/docs/security', label: 'Security' },
        { href: '/docs/architecture', label: 'Architecture' },
        { href: '/docs/upgrading', label: 'Upgrading' },
        { href: '/docs/faq', label: 'FAQ' },
        { href: '/privacy', label: 'Privacy' },
      ],
    },
    {
      title: 'Open source',
      links: [
        { href: GITHUB.repo, label: 'GitHub' },
        { href: GITHUB.issues, label: 'Issues' },
        { href: GITHUB.license, label: 'MIT License' },
        { href: '/llms.txt', label: 'llms.txt' },
      ],
    },
  ];
</script>

<footer class="footer">
  <div class="container">
    <div class="top">
      <div class="about">
        <a href="/" aria-label="Searchkeep home"><Logo /></a>
        <p>SEO &amp; GEO analytics that lives in your own Cloudflare account. Free and open source under the MIT license.</p>
      </div>
      {#each columns as col (col.title)}
        <nav class="col" aria-label={col.title}>
          <h2>{col.title}</h2>
          <ul>
            {#each col.links as l (l.href)}
              <li><a href={l.href}>{l.label}</a></li>
            {/each}
          </ul>
        </nav>
      {/each}
    </div>
    <div class="bottom">
      <span>© 2026 Searchkeep contributors · v{SITE.version}</span>
      <span>This site sets no cookies and runs no trackers.</span>
    </div>
  </div>
</footer>

<style>
  .footer {
    border-top: 1px solid var(--line);
    padding-block: 56px 32px;
    font-size: var(--fs-sm);
    background: linear-gradient(180deg, transparent, light-dark(rgb(0 0 0 / 0.015), rgb(255 255 255 / 0.012)));
  }
  .top {
    display: grid;
    grid-template-columns: 1.6fr repeat(4, 1fr);
    gap: 32px;
  }
  .about p {
    margin-top: 14px;
    max-width: 290px;
    color: var(--text-3);
    line-height: 1.6;
  }
  .col h2 {
    font-size: var(--fs-sm);
    font-weight: 550;
    letter-spacing: -0.01em;
    color: var(--text);
    margin-bottom: 12px;
  }
  .col ul {
    list-style: none;
    padding: 0;
    display: grid;
    gap: 8px;
  }
  .col a {
    color: var(--text-3);
    transition: color 150ms;
  }
  .col a:hover {
    color: var(--text);
  }
  .bottom {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 8px 24px;
    margin-top: 48px;
    padding-top: 20px;
    border-top: 1px solid var(--line);
    color: var(--text-4);
    font-size: var(--fs-xs);
  }
  @media (max-width: 900px) {
    .top {
      grid-template-columns: repeat(2, 1fr);
    }
    .about {
      grid-column: 1 / -1;
    }
  }
</style>

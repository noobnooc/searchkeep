<script lang="ts">
  import { page } from '$app/state';
  import { GITHUB } from '../site';
  import Logo from './Logo.svelte';
  import Icon from './Icon.svelte';

  const links = [
    { href: '/#funnel', label: 'GEO funnel' },
    { href: '/#mcp', label: 'MCP' },
    { href: '/#security', label: 'Security' },
    { href: '/docs', label: 'Docs' },
    { href: '/changelog', label: 'Changelog' },
  ];
  const isCurrent = (href: string) =>
    !href.includes('#') && (page.url.pathname === href || page.url.pathname.startsWith(href + '/'));
</script>

<header class="header" data-header>
  <div class="inner container">
    <a href="/" class="brand" aria-label="Searchkeep home"><Logo /></a>

    <nav class="nav" aria-label="Main">
      <ul>
        {#each links as l (l.href)}
          <li>
            <a href={l.href} aria-current={isCurrent(l.href) ? 'page' : undefined}>{l.label}</a>
          </li>
        {/each}
      </ul>
    </nav>

    <div class="actions">
      <button type="button" class="icon-btn theme" data-theme-toggle hidden aria-label="Toggle color theme">
        <span class="sun"><Icon name="sun" size={16} /></span>
        <span class="moon"><Icon name="moon" size={16} /></span>
      </button>
      <a class="icon-btn gh" href={GITHUB.repo} aria-label="Searchkeep on GitHub">
        <Icon name="github" size={17} />
      </a>
      <a class="btn btn-primary deploy" href="/docs/deploy">Deploy</a>

      <details class="menu" data-menu>
        <summary class="icon-btn" aria-label="Open menu">
          <span class="open"><Icon name="menu" size={18} /></span>
          <span class="shut"><Icon name="close" size={18} /></span>
        </summary>
        <div class="sheet">
          <nav aria-label="Mobile">
            <ul>
              {#each links as l (l.href)}
                <li><a href={l.href}>{l.label}</a></li>
              {/each}
              <li><a href={GITHUB.repo}>GitHub</a></li>
            </ul>
          </nav>
          <a class="btn btn-primary btn-lg" href="/docs/deploy">Deploy to your Cloudflare</a>
        </div>
      </details>
    </div>
  </div>
</header>

<style>
  .header {
    position: sticky;
    top: 0;
    z-index: 50;
    height: var(--header-h);
    background: var(--overlay);
    -webkit-backdrop-filter: saturate(180%) blur(14px);
    backdrop-filter: saturate(180%) blur(14px);
    border-bottom: 1px solid transparent;
    transition: border-color 200ms var(--ease), background-color 200ms var(--ease);
  }
  .header:global([data-scrolled]) {
    border-bottom-color: var(--line);
  }
  :global(html:not(.js)) .header {
    border-bottom-color: var(--line);
  }
  .inner {
    display: flex;
    align-items: center;
    height: 100%;
    gap: 24px;
  }
  .brand {
    display: inline-flex;
    border-radius: 8px;
  }
  .nav {
    flex: 1;
  }
  .nav ul {
    display: flex;
    justify-content: center;
    gap: 2px;
    list-style: none;
    padding: 0;
  }
  .nav a {
    display: block;
    padding: 6px 12px;
    border-radius: 8px;
    font-size: var(--fs-sm);
    font-weight: 500;
    color: var(--text-2);
    transition: color 150ms, background-color 150ms;
  }
  .nav a:hover,
  .nav a[aria-current='page'] {
    color: var(--text);
  }
  .nav a:hover {
    background: var(--surface-2);
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-left: auto;
  }
  .icon-btn {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    border-radius: 9px;
    border: 1px solid transparent;
    background: transparent;
    color: var(--text-2);
    transition: color 150ms, background-color 150ms, border-color 150ms;
  }
  .icon-btn:hover {
    color: var(--text);
    background: var(--surface-2);
    border-color: var(--line);
  }
  .deploy {
    height: 34px;
    margin-left: 6px;
    padding-inline: 14px;
  }
  .theme .sun {
    display: none;
  }
  :global(:root[data-theme='light']) .theme .sun {
    display: block;
  }
  :global(:root[data-theme='light']) .theme .moon {
    display: none;
  }
  @media (prefers-color-scheme: light) {
    :global(:root:not([data-theme='dark'])) .theme .sun {
      display: block;
    }
    :global(:root:not([data-theme='dark'])) .theme .moon {
      display: none;
    }
  }

  .menu {
    display: none;
    position: relative;
  }
  .menu summary {
    list-style: none;
  }
  .menu summary::-webkit-details-marker {
    display: none;
  }
  .menu .shut,
  .menu[open] .open {
    display: none;
  }
  .menu[open] .shut {
    display: block;
  }
  .sheet {
    position: fixed;
    left: 0;
    right: 0;
    top: var(--header-h);
    padding: 12px var(--gutter) 24px;
    background: var(--bg);
    border-bottom: 1px solid var(--line);
    box-shadow: var(--shadow-lg);
  }
  .sheet ul {
    list-style: none;
    padding: 0;
    margin-bottom: 16px;
  }
  .sheet li a {
    display: block;
    padding: 12px 4px;
    border-bottom: 1px solid var(--line);
    font-size: var(--fs-md);
    font-weight: 500;
    color: var(--text);
  }
  .sheet .btn {
    width: 100%;
  }

  @media (max-width: 860px) {
    .nav,
    .gh,
    .deploy {
      display: none;
    }
    .menu {
      display: block;
    }
  }
</style>

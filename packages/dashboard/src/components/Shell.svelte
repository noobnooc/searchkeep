<script lang="ts">
  import type { Snippet } from 'svelte';
  import { href, router, type ViewId } from '../lib/router.svelte';
  import { effectiveTheme, ui } from '../lib/state.svelte';
  import Icon, { type IconName } from './Icon.svelte';
  import Logo from './Logo.svelte';
  import SiteSwitcher from './SiteSwitcher.svelte';

  interface Props {
    children: Snippet;
  }
  let { children }: Props = $props();

  interface NavItem {
    view: ViewId;
    label: string;
    icon: IconName;
  }
  const NAV: Array<{ heading?: string; items: NavItem[] }> = [
    {
      items: [
        { view: 'overview', label: 'Overview', icon: 'overview' },
        { view: 'geo', label: 'GEO funnel', icon: 'funnel' },
      ],
    },
    {
      heading: 'Search',
      items: [
        { view: 'performance', label: 'Performance', icon: 'performance' },
        { view: 'compare', label: 'Compare', icon: 'compare' },
        { view: 'opportunities', label: 'Opportunities', icon: 'opportunities' },
      ],
    },
    {
      heading: 'AI',
      items: [
        { view: 'ai-crawlers', label: 'AI crawlers', icon: 'bot' },
        { view: 'ai-referrals', label: 'AI referrals', icon: 'referral' },
      ],
    },
    {
      heading: 'Site',
      items: [{ view: 'technical', label: 'Technical', icon: 'technical' }],
    },
  ];

  let menuOpen = $state(false);
  let themeTick = $state(0);
  const theme = $derived((void themeTick, void ui.theme, effectiveTheme()));

  // Close the mobile menu on navigation.
  $effect(() => {
    void router.route;
    menuOpen = false;
  });

  $effect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') menuOpen = false;
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  // Track OS theme changes while on "system".
  $effect(() => {
    let mq: MediaQueryList | null = null;
    try {
      mq = window.matchMedia('(prefers-color-scheme: light)');
    } catch {
      return;
    }
    const on = () => themeTick++;
    mq.addEventListener('change', on);
    return () => mq?.removeEventListener('change', on);
  });

  function toggleTheme() {
    ui.setTheme(theme === 'dark' ? 'light' : 'dark');
  }

  // Coverage lists every dataset, with null dates until something was synced.
  const noData = $derived(Boolean(ui.site && !ui.site.data.some((d) => d.lastDate)));
</script>

{#snippet nav()}
  <nav aria-label="Main">
    {#each NAV as group, gi (gi)}
      <div class="group">
        {#if group.heading}<div class="heading">{group.heading}</div>{/if}
        {#each group.items as item (item.view)}
          <a class="nav-item" href={href(item.view)} aria-current={router.view === item.view ? 'page' : undefined}>
            <Icon name={item.icon} size={16} />
            <span>{item.label}</span>
          </a>
        {/each}
      </div>
    {/each}
  </nav>
{/snippet}

{#snippet foot()}
  <div class="foot">
    <a class="nav-item" href={href('settings')} aria-current={router.view === 'settings' ? 'page' : undefined}>
      <Icon name="settings" size={16} />
      <span>Settings</span>
      {#if noData}<span class="dot-badge" title="No data synced yet"></span>{/if}
    </a>
    <div class="me">
      <span class="email truncate" title={ui.status?.identity?.email}>{ui.status?.identity?.email ?? ''}</span>
      {#if ui.status?.dev}<span class="dev" title="Local development mode with demo data">dev</span>{/if}
      <button class="btn ghost icon theme" onclick={toggleTheme} aria-label="Switch to {theme === 'dark' ? 'light' : 'dark'} theme" title="Switch to {theme === 'dark' ? 'light' : 'dark'} theme">
        <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={15} />
      </button>
    </div>
  </div>
{/snippet}

<div class="app">
  <div class="side-col">
    <aside class="side">
      <div class="brand"><a href={href('overview')} aria-label="Searchkeep overview"><Logo /></a></div>
      <SiteSwitcher />
      {@render nav()}
      <div class="spacer"></div>
      {@render foot()}
    </aside>
  </div>

  <header class="topbar">
    <a href={href('overview')} aria-label="Searchkeep overview"><Logo size={22} /></a>
    <span class="spacer"></span>
    <button class="btn ghost icon" onclick={toggleTheme} aria-label="Switch to {theme === 'dark' ? 'light' : 'dark'} theme">
      <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={16} />
    </button>
    <button class="btn ghost icon" aria-expanded={menuOpen} aria-controls="mobile-menu" aria-label={menuOpen ? 'Close menu' : 'Open menu'} onclick={() => (menuOpen = !menuOpen)}>
      <Icon name={menuOpen ? 'x' : 'menu'} size={18} />
    </button>
  </header>
  {#if menuOpen}
    <button class="scrim" aria-label="Close menu" tabindex="-1" onclick={() => (menuOpen = false)}></button>
    <div class="drawer" id="mobile-menu">
      <SiteSwitcher />
      {@render nav()}
      {@render foot()}
    </div>
  {/if}

  <main class="main">
    <div class="content">
      {#if noData && router.view !== 'settings' && router.view !== 'overview'}
        <div class="nodata" role="status">
          <Icon name="sync" size={16} />
          <div>
            <strong>No data synced for {ui.site?.domain} yet.</strong>
            <span>Searchkeep syncs automatically every 15 minutes once setup is complete; the first passes backfill history in small batches.</span>
          </div>
          <a class="btn sm" href={href('settings', 'sync')}>Sync now <Icon name="arrowRight" size={13} /></a>
        </div>
      {/if}
      {@render children()}
    </div>
  </main>
</div>

<style>
  .app {
    min-height: 100vh;
    display: grid;
    grid-template-columns: var(--side-w) minmax(0, 1fr);
  }
  .side-col {
    background: var(--bg-side);
    border-right: 1px solid var(--border);
    min-width: 0;
  }
  .side {
    position: sticky;
    top: 0;
    height: 100vh;
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 14px 12px 12px;
    overflow-y: auto;
  }
  .brand {
    padding: 4px 6px 2px;
  }
  .brand a:hover {
    text-decoration: none;
  }
  nav {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .group {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .heading {
    font-family: var(--mono);
    font-size: 10.5px;
    font-weight: 500;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-4);
    padding: 0 8px 5px;
  }
  .nav-item {
    position: relative;
    display: flex;
    align-items: center;
    gap: 9px;
    height: 30px;
    padding: 0 8px;
    border-radius: 6px;
    color: var(--text-2);
    font-size: 13px;
    font-weight: 500;
  }
  .nav-item:hover {
    background: var(--neutral-wash);
    color: var(--text);
    text-decoration: none;
  }
  .nav-item[aria-current='page'] {
    background: var(--surface-3);
    color: var(--text);
  }
  .nav-item[aria-current='page'] :global(.icon) {
    color: var(--accent-text);
  }
  .dot-badge {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--warn);
    margin-left: auto;
  }
  .spacer {
    flex: 1;
  }
  .foot {
    display: flex;
    flex-direction: column;
    gap: 6px;
    border-top: 1px solid var(--border);
    padding-top: 10px;
  }
  .me {
    display: flex;
    align-items: center;
    gap: 6px;
    padding-left: 8px;
    min-width: 0;
  }
  .email {
    font-size: 12px;
    color: var(--text-3);
    flex: 1;
    min-width: 0;
  }
  .dev {
    font-family: var(--mono);
    font-size: 10.5px;
    font-weight: 500;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    padding: 1px 5px;
    border-radius: 4px;
    color: var(--warn);
    background: var(--warn-wash);
  }
  .theme {
    width: 28px;
    height: 28px;
  }

  .topbar,
  .drawer,
  .scrim {
    display: none;
  }

  .main {
    min-width: 0;
  }
  .content {
    max-width: 1320px;
    margin: 0 auto;
    padding: 28px 32px 64px;
  }
  .nodata {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 14px;
    margin-bottom: 20px;
    border-radius: var(--radius);
    border: 1px solid var(--border-2);
    background: var(--surface-2);
    color: var(--accent-text);
    font-size: 13px;
    flex-wrap: wrap;
  }
  .nodata div {
    flex: 1 1 260px;
    display: flex;
    flex-direction: column;
    color: var(--text-2);
  }
  .nodata strong {
    color: var(--text);
    font-weight: 600;
  }

  @media (max-width: 900px) {
    .app {
      grid-template-columns: minmax(0, 1fr);
    }
    .side-col {
      display: none;
    }
    .topbar {
      position: sticky;
      top: 0;
      z-index: 50;
      display: flex;
      align-items: center;
      gap: 4px;
      height: 52px;
      padding: 0 8px 0 16px;
      background: color-mix(in srgb, var(--bg) 88%, transparent);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      border-bottom: 1px solid var(--border);
    }
    .topbar a:hover {
      text-decoration: none;
    }
    .scrim {
      display: block;
      position: fixed;
      inset: 52px 0 0 0;
      z-index: 48;
      border: 0;
      background: rgba(0, 0, 0, 0.45);
    }
    .drawer {
      display: flex;
      flex-direction: column;
      gap: 14px;
      position: fixed;
      top: 52px;
      left: 0;
      right: 0;
      z-index: 49;
      max-height: calc(100vh - 52px);
      overflow-y: auto;
      padding: 12px 16px 16px;
      background: var(--bg-side);
      border-bottom: 1px solid var(--border);
      box-shadow: var(--shadow-pop);
    }
    .drawer nav {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }
    .content {
      padding: 20px 16px 48px;
    }
  }
</style>

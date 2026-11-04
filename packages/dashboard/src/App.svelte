<script lang="ts">
  import EmptyState from './components/EmptyState.svelte';
  import ErrorBanner from './components/ErrorBanner.svelte';
  import Icon from './components/Icon.svelte';
  import Locked from './components/Locked.svelte';
  import Logo from './components/Logo.svelte';
  import Shell from './components/Shell.svelte';
  import { ApiError, apiUrl, onLocked, request } from './lib/api';
  import { href, router } from './lib/router.svelte';
  import { ui } from './lib/state.svelte';
  import type { SitesResponse, StatusResponse } from './lib/types';
  import AiCrawlers from './views/AiCrawlers.svelte';
  import AiReferrals from './views/AiReferrals.svelte';
  import Compare from './views/Compare.svelte';
  import GeoFunnel from './views/GeoFunnel.svelte';
  import Opportunities from './views/Opportunities.svelte';
  import Overview from './views/Overview.svelte';
  import Performance from './views/Performance.svelte';
  import Settings from './views/Settings.svelte';
  import Technical from './views/Technical.svelte';

  let phase = $state<'loading' | 'locked' | 'ready' | 'error'>('loading');
  let bootError = $state<unknown>(null);
  let checking = $state(false);

  async function loadSites() {
    const res = await request<SitesResponse>('/api/sites');
    ui.setSites(res.sites);
  }

  async function boot(refresh = false) {
    checking = true;
    try {
      const status = await request<StatusResponse>(apiUrl('/api/status', { refresh: refresh ? 1 : undefined }));
      ui.status = status;
      if (status.state !== 'ready') {
        phase = 'locked';
        return;
      }
      await loadSites();
      phase = 'ready';
    } catch (err) {
      if (err instanceof ApiError && err.code === 'locked') return; // handled by onLocked
      bootError = err;
      phase = 'error';
    } finally {
      checking = false;
    }
  }

  onLocked((body) => {
    const prev = ui.status;
    ui.status = {
      state: body.state,
      checks: body.checks ?? prev?.checks ?? [],
      checkedAt: new Date().toISOString(),
      identity: prev?.identity ?? null,
      configErrors: prev?.configErrors ?? [],
      dev: prev?.dev ?? false,
    };
    phase = 'locked';
  });

  // Opening the dashboard forces a fresh Access check (ADR 0003); later checks use the cached result.
  boot(true);

  const VIEW_TITLES: Record<string, string> = {
    overview: 'Overview',
    geo: 'GEO funnel',
    performance: 'Performance',
    compare: 'Compare',
    opportunities: 'Opportunities',
    'ai-crawlers': 'AI crawlers',
    'ai-referrals': 'AI referrals',
    technical: 'Technical',
    settings: 'Settings',
  };
  $effect(() => {
    document.title = phase === 'locked' ? 'Locked · Searchkeep' : `${VIEW_TITLES[router.view] ?? 'Searchkeep'} · Searchkeep`;
  });
</script>

{#if phase === 'loading'}
  <div class="boot" aria-busy="true">
    <Logo size={28} wordmark={false} />
    <span class="sr-only">Loading Searchkeep</span>
  </div>
{:else if phase === 'error'}
  <div class="boot">
    <div class="boot-error">
      <Logo />
      <ErrorBanner error={bootError} title="Searchkeep could not start" retry={() => boot()} />
    </div>
  </div>
{:else if phase === 'locked' && ui.status}
  <Locked status={ui.status} {checking} onrecheck={() => boot(true)} />
{:else}
  <Shell>
    {#if ui.sites.length === 0 && router.view !== 'settings'}
      <EmptyState title="Add your first site" icon="globe">
        <p>Tell Searchkeep which site to analyse. You only need its domain; Search Console, Bing and Cloudflare can be connected in the same form.</p>
        {#snippet actions()}
          <a class="btn primary" href={href('settings', 'sites')}><Icon name="plus" size={14} /> Add a site</a>
        {/snippet}
      </EmptyState>
    {:else}
      {#key ui.siteId}
        {#if router.view === 'overview'}
          <Overview />
        {:else if router.view === 'geo'}
          <GeoFunnel />
        {:else if router.view === 'performance'}
          <Performance />
        {:else if router.view === 'compare'}
          <Compare />
        {:else if router.view === 'opportunities'}
          <Opportunities />
        {:else if router.view === 'ai-crawlers'}
          <AiCrawlers />
        {:else if router.view === 'ai-referrals'}
          <AiReferrals />
        {:else if router.view === 'technical'}
          <Technical />
        {:else if router.view === 'settings'}
          <Settings reloadSites={loadSites} />
        {/if}
      {/key}
    {/if}
  </Shell>
{/if}

<style>
  .boot {
    min-height: 100vh;
    display: grid;
    place-items: center;
    padding: 24px 16px;
  }
  .boot > :global(.logo) {
    animation: pulse 1.6s ease-in-out infinite;
  }
  @keyframes pulse {
    50% {
      opacity: 0.45;
    }
  }
  .boot-error {
    width: 100%;
    max-width: 520px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
</style>

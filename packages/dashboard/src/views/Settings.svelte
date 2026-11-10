<script lang="ts">
  /**
   * Settings, one section at a time (#/settings/<section>): what Searchkeep tracks (sites, apps),
   * its data (sync, stored data and imports), the deployment (setup checks, AI clients) and
   * preferences for this browser.
   */
  import { tick } from 'svelte';
  import AppsManager from '../components/AppsManager.svelte';
  import Icon, { type IconName } from '../components/Icon.svelte';
  import PageHeader from '../components/PageHeader.svelte';
  import SitesManager from '../components/SitesManager.svelte';
  import { apiUrl } from '../lib/api';
  import { resource } from '../lib/resource.svelte';
  import { href, router } from '../lib/router.svelte';
  import { ui } from '../lib/state.svelte';
  import { syncWatch } from '../lib/sync.svelte';
  import type { SetupStatusResponse } from '../lib/types';
  import AppearanceSection from './settings/AppearanceSection.svelte';
  import ChecksSection from './settings/ChecksSection.svelte';
  import DataSection from './settings/DataSection.svelte';
  import McpSection from './settings/McpSection.svelte';
  import SyncSection from './settings/SyncSection.svelte';

  interface Props {
    reloadSites: () => Promise<void>;
  }
  let { reloadSites }: Props = $props();

  type SectionId = 'sites' | 'apps' | 'sync' | 'data' | 'checks' | 'mcp' | 'appearance';
  interface Section {
    id: SectionId;
    label: string;
    icon: IconName;
  }
  const GROUPS: Array<{ heading: string; items: Section[] }> = [
    {
      heading: 'Properties',
      items: [
        { id: 'sites', label: 'Sites', icon: 'globe' },
        { id: 'apps', label: 'Apps', icon: 'phone' },
      ],
    },
    {
      heading: 'Data',
      items: [
        { id: 'sync', label: 'Sync', icon: 'sync' },
        { id: 'data', label: 'Stored data', icon: 'database' },
      ],
    },
    {
      heading: 'Deployment',
      items: [
        { id: 'checks', label: 'Setup checks', icon: 'shield' },
        { id: 'mcp', label: 'AI clients', icon: 'terminal' },
      ],
    },
    { heading: 'Preferences', items: [{ id: 'appearance', label: 'Appearance', icon: 'monitor' }] },
  ];
  const IDS = GROUPS.flatMap((g) => g.items.map((i) => i.id)) as string[];
  /** Older links (#/settings/progress, …) point into the sections that now hold them. */
  const ALIASES: Record<string, { section: SectionId; anchor?: string }> = {
    progress: { section: 'sync' },
    coverage: { section: 'data' },
    import: { section: 'data', anchor: 'settings-import' },
  };
  const target = $derived.by((): { section: SectionId; anchor?: string } => {
    const sub = router.sub ?? '';
    if (IDS.includes(sub)) return { section: sub as SectionId };
    return ALIASES[sub] ?? { section: 'sites' };
  });
  const section = $derived(target.section);

  // A new section starts at the top; an alias with an anchor scrolls to its card.
  $effect(() => {
    const { anchor } = target;
    tick().then(() => {
      const el = anchor ? document.getElementById(anchor) : null;
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      else window.scrollTo({ top: 0 });
    });
  });

  // Setup checks and coverage come from one request; it also gives the nav its problem count.
  const setup = resource<SetupStatusResponse>(() => apiUrl('/api/setup-status'));
  const problems = $derived((setup.data?.checks ?? []).filter((c) => c.status === 'error').length);
  const syncBusy = $derived(Boolean(syncWatch.progress && syncWatch.progress.phase !== 'done' && syncWatch.progress.phase !== 'waiting'));

  function badge(id: SectionId): { text: string; tone: 'count' | 'error' | 'dot'; title?: string } | null {
    if (id === 'sites' && ui.sites.length) return { text: String(ui.sites.length), tone: 'count' };
    if (id === 'apps' && ui.apps.length) return { text: String(ui.apps.length), tone: 'count' };
    if (id === 'checks' && problems) return { text: String(problems), tone: 'error', title: `${problems} to fix` };
    if (id === 'sync' && syncBusy) return { text: '', tone: 'dot', title: 'Sync in progress' };
    return null;
  }
</script>

<PageHeader title="Settings" range={false} hasMeta={false} />

<div class="settings">
  <nav class="subnav" aria-label="Settings sections">
    {#each GROUPS as g (g.heading)}
      <div class="group">
        <div class="heading">{g.heading}</div>
        {#each g.items as item (item.id)}
          {@const b = badge(item.id)}
          <a href={href('settings', item.id)} aria-current={section === item.id ? 'page' : undefined}>
            <Icon name={item.icon} size={15} />
            <span class="label">{item.label}</span>
            {#if b}
              <span class="badge {b.tone}" title={b.title}>{b.text}</span>
            {/if}
          </a>
        {/each}
      </div>
    {/each}
  </nav>

  <div class="panel">
    {#if section === 'sites'}
      <SitesManager {reloadSites} />
    {:else if section === 'apps'}
      <AppsManager {reloadSites} />
    {:else if section === 'sync'}
      <SyncSection {reloadSites} />
    {:else if section === 'data'}
      <DataSection {setup} {reloadSites} />
    {:else if section === 'checks'}
      <ChecksSection {setup} />
    {:else if section === 'mcp'}
      <McpSection />
    {:else if section === 'appearance'}
      <AppearanceSection />
    {/if}
  </div>
</div>

<style>
  .settings {
    display: grid;
    grid-template-columns: 196px minmax(0, 1fr);
    gap: 28px;
    align-items: start;
  }
  .subnav {
    position: sticky;
    top: 28px;
    display: flex;
    flex-direction: column;
    gap: 16px;
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
    color: var(--text-3);
    padding: 0 10px 4px;
  }
  .subnav a {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 6px 10px;
    border-radius: 7px;
    color: var(--text-2);
    font-size: 13.5px;
    text-decoration: none;
    white-space: nowrap;
  }
  .subnav a:hover {
    background: var(--neutral-wash);
    color: var(--text);
  }
  .subnav a[aria-current='page'] {
    background: var(--surface);
    color: var(--text);
    font-weight: 550;
    box-shadow: var(--shadow-card);
    border: 1px solid var(--border);
    padding: 5px 9px;
  }
  .label {
    flex: 1;
    min-width: 0;
  }
  .badge {
    font-family: var(--mono);
    font-size: 11px;
    line-height: 18px;
    min-width: 18px;
    padding: 0 5px;
    border-radius: 9px;
    text-align: center;
    color: var(--text-3);
    background: var(--neutral-wash);
  }
  .badge.error {
    color: var(--neg);
    background: var(--neg-wash);
    font-weight: 600;
  }
  .badge.dot {
    min-width: 0;
    width: 7px;
    height: 7px;
    padding: 0;
    margin-right: 5px;
    background: var(--accent);
  }
  .panel {
    display: flex;
    flex-direction: column;
    gap: 16px;
    min-width: 0;
  }

  @media (max-width: 900px) {
    .settings {
      grid-template-columns: minmax(0, 1fr);
      gap: 14px;
    }
    /* One scrolling row of sections, without the group headings. */
    .subnav {
      position: static;
      flex-direction: row;
      gap: 4px;
      overflow-x: auto;
      scrollbar-width: none;
      margin: 0 -16px;
      padding: 2px 16px 4px;
    }
    .subnav::-webkit-scrollbar {
      display: none;
    }
    .group {
      flex-direction: row;
      gap: 4px;
    }
    .heading {
      display: none;
    }
    .subnav a {
      border: 1px solid var(--border);
      padding: 5px 10px;
    }
    .subnav a[aria-current='page'] {
      padding: 5px 10px;
    }
  }
</style>

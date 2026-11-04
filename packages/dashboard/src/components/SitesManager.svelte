<script lang="ts" module>
  /** Survives the remount that happens when the newly added site gets selected. */
  let pendingNotice: string | null = null;
</script>

<script lang="ts">
  /**
   * Add, edit and remove the sites Searchkeep analyses. Sites are stored in D1;
   * sites from the SITES secret are shown read-only. Suggestions come from what
   * the configured credentials can see (/api/discover).
   */
  import Card from './Card.svelte';
  import EmptyState from './EmptyState.svelte';
  import ErrorBanner from './ErrorBanner.svelte';
  import Icon from './Icon.svelte';
  import Pill from './Pill.svelte';
  import Skeleton from './Skeleton.svelte';
  import { request } from '../lib/api';
  import { refreshAll, resource } from '../lib/resource.svelte';
  import { ui } from '../lib/state.svelte';
  import type { DiscoverResponse, SiteConfig, SiteConfigsResponse } from '../lib/types';

  interface Props {
    reloadSites: () => Promise<void>;
  }
  let { reloadSites }: Props = $props();

  const configs = resource<SiteConfigsResponse>(() => '/api/site-configs');
  let discovery = $state.raw<DiscoverResponse | null>(null);
  let discovering = $state(false);

  type Form = { mode: 'create' | 'edit'; id: string; domain: string; gscProperty: string; bingSiteUrl: string; cloudflareZoneId: string; webAnalyticsSiteTag: string; brandRegex: string };
  const empty = (): Form => ({ mode: 'create', id: '', domain: '', gscProperty: '', bingSiteUrl: '', cloudflareZoneId: '', webAnalyticsSiteTag: '', brandRegex: '' });
  let form = $state<Form | null>(null);
  let saving = $state(false);
  let error = $state.raw<unknown>(null);
  let notice = $state<string | null>(pendingNotice);
  pendingNotice = null;

  async function loadDiscovery() {
    if (discovery || discovering) return;
    discovering = true;
    try {
      discovery = await request<DiscoverResponse>('/api/discover');
    } catch {
      discovery = null;
    } finally {
      discovering = false;
    }
  }

  function openCreate() {
    form = empty();
    error = null;
    notice = null;
    void loadDiscovery();
  }

  function openEdit(s: SiteConfig) {
    form = {
      mode: 'edit',
      id: s.id,
      domain: s.domain,
      gscProperty: s.gscProperty ?? '',
      bingSiteUrl: s.bingSiteUrl ?? '',
      cloudflareZoneId: s.cloudflareZoneId ?? '',
      webAnalyticsSiteTag: s.webAnalyticsSiteTag ?? '',
      brandRegex: s.brandRegex ?? '',
    };
    error = null;
    notice = null;
    void loadDiscovery();
  }

  const bare = (d: string) =>
    d
      .trim()
      .toLowerCase()
      .replace(/^[a-z]+:\/\//, '')
      .split('/')[0]!
      .replace(/^www\./, '');

  /** Fills empty fields with the identifiers that match the domain. */
  function autofill() {
    if (!form || !discovery) return;
    const d = bare(form.domain);
    if (!d) return;
    const apex = d.split('.').slice(-2).join('.');
    let filled = 0;
    if (!form.gscProperty && discovery.gscProperties.ok) {
      const props = discovery.gscProperties.items.map((p) => p.siteUrl);
      const hit = props.find((p) => p === `sc-domain:${d}`) ?? props.find((p) => p === `sc-domain:${apex}`) ?? props.find((p) => bare(p) === d);
      if (hit) {
        form.gscProperty = hit;
        filled++;
      }
    }
    if (!form.bingSiteUrl && discovery.bingSites.ok) {
      const hit = discovery.bingSites.items.find((s) => bare(s.url) === d);
      if (hit) {
        form.bingSiteUrl = hit.url;
        filled++;
      }
    }
    if (!form.cloudflareZoneId && discovery.zones.ok) {
      const hit = discovery.zones.items.find((z) => z.name === d) ?? discovery.zones.items.find((z) => z.name === apex);
      if (hit) {
        form.cloudflareZoneId = hit.id;
        filled++;
      }
    }
    if (!form.webAnalyticsSiteTag && discovery.webAnalytics.ok) {
      const hit = discovery.webAnalytics.items.find((w) => w.host && bare(w.host) === d) ?? discovery.webAnalytics.items.find((w) => w.host && bare(w.host) === apex);
      if (hit) {
        form.webAnalyticsSiteTag = hit.siteTag;
        filled++;
      }
    }
    notice = filled ? `Filled ${filled} field${filled === 1 ? '' : 's'} from your connected accounts. Check them before saving.` : 'Nothing matched this domain in your connected accounts.';
  }

  async function save(e: SubmitEvent) {
    e.preventDefault();
    if (!form) return;
    saving = true;
    error = null;
    try {
      const body: Record<string, string> = { mode: form.mode, domain: form.domain };
      if (form.mode === 'edit') body.id = form.id;
      for (const k of ['gscProperty', 'bingSiteUrl', 'cloudflareZoneId', 'webAnalyticsSiteTag', 'brandRegex'] as const) {
        if (form[k].trim()) body[k] = form[k].trim();
      }
      const res = await request<{ site: SiteConfig; created: boolean }>('/api/site-configs', {
        method: 'POST',
        body: JSON.stringify(body),
        contentType: 'application/json',
      });
      form = null;
      notice = res.created ? `Added ${res.site.domain}. The next sync (within 15 minutes) starts pulling its data; use Sync now to start right away.` : `Saved ${res.site.domain}.`;
      pendingNotice = notice;
      configs.reload();
      refreshAll();
      await reloadSites();
      if (res.created) ui.setSite(res.site.id);
    } catch (err) {
      error = err;
    } finally {
      saving = false;
    }
  }

  async function remove(s: SiteConfig) {
    if (!window.confirm(`Remove ${s.domain} from Searchkeep? Data already synced stays in your database; add the site again to see it.`)) return;
    error = null;
    try {
      await request(`/api/site-configs/${encodeURIComponent(s.id)}`, { method: 'DELETE' });
      notice = `Removed ${s.domain}.`;
      configs.reload();
      refreshAll();
      await reloadSites();
    } catch (err) {
      error = err;
    }
  }

  const SOURCES: Array<{ key: keyof SiteConfig; label: string }> = [
    { key: 'gscProperty', label: 'Search Console' },
    { key: 'bingSiteUrl', label: 'Bing' },
    { key: 'cloudflareZoneId', label: 'AI crawlers' },
    { key: 'webAnalyticsSiteTag', label: 'Web Analytics' },
  ];
</script>

<Card title="Sites" subtitle="The sites Searchkeep analyses. Each source is optional; connect what you have." id="settings-sites">
  {#snippet actions()}
    {#if !form}
      <button class="btn primary sm" onclick={openCreate}><Icon name="plus" size={14} /> Add site</button>
    {/if}
  {/snippet}

  {#if notice}<p class="notice" role="status"><Icon name="info" size={14} /> {notice}</p>{/if}
  {#if error}<div class="mb"><ErrorBanner {error} title="Could not save the site" /></div>{/if}

  {#if form}
    <form class="site-form" onsubmit={save}>
      <div class="row">
        <label for="sf-domain">Domain <span class="req">required</span></label>
        <div class="with-btn">
          <input id="sf-domain" class="input" type="text" inputmode="url" placeholder="example.com" bind:value={form.domain} disabled={form.mode === 'edit'} autocomplete="off" spellcheck="false" required />
          <button type="button" class="btn sm" onclick={autofill} disabled={!discovery || !form.domain.trim()} title="Find this domain in Search Console, Bing and Cloudflare">
            <Icon name="sparkle" size={14} /> {discovering ? 'Looking…' : 'Auto-fill'}
          </button>
        </div>
        <p class="hint">Without https://. Add each subdomain as its own site.</p>
      </div>

      <div class="grid">
        <div class="row">
          <label for="sf-gsc">Search Console property</label>
          <input id="sf-gsc" class="input" list="sf-gsc-list" placeholder="sc-domain:example.com" bind:value={form.gscProperty} autocomplete="off" spellcheck="false" />
          <datalist id="sf-gsc-list">
            {#if discovery?.gscProperties.ok}{#each discovery.gscProperties.items as p (p.siteUrl)}<option value={p.siteUrl}>{p.permissionLevel}</option>{/each}{/if}
          </datalist>
          <p class="hint">{discovery && !discovery.gscProperties.ok ? discovery.gscProperties.reason : 'sc-domain:example.com or https://example.com/'}</p>
        </div>
        <div class="row">
          <label for="sf-bing">Bing site URL</label>
          <input id="sf-bing" class="input" list="sf-bing-list" placeholder="https://example.com/" bind:value={form.bingSiteUrl} autocomplete="off" spellcheck="false" />
          <datalist id="sf-bing-list">
            {#if discovery?.bingSites.ok}{#each discovery.bingSites.items as b (b.url)}<option value={b.url}>{b.verified ? 'verified' : 'not verified'}</option>{/each}{/if}
          </datalist>
          <p class="hint">{discovery && !discovery.bingSites.ok ? discovery.bingSites.reason : 'As listed in Bing Webmaster Tools.'}</p>
        </div>
        <div class="row">
          <label for="sf-zone">Cloudflare zone (AI crawlers)</label>
          <input id="sf-zone" class="input mono" list="sf-zone-list" placeholder="Zone ID" bind:value={form.cloudflareZoneId} autocomplete="off" spellcheck="false" />
          <datalist id="sf-zone-list">
            {#if discovery?.zones.ok}{#each discovery.zones.items as z (z.id)}<option value={z.id}>{z.name}</option>{/each}{/if}
          </datalist>
          <p class="hint">
            {#if discovery && !discovery.zones.ok}To pick from a list, add <b>Zone: Read</b> to the API token.{/if}
            The zone must be proxied through Cloudflare (orange cloud). Zone ID: Cloudflare dashboard → your domain → Overview.
          </p>
        </div>
        <div class="row">
          <label for="sf-rum">Web Analytics site tag</label>
          <input id="sf-rum" class="input mono" list="sf-rum-list" placeholder="Site tag" bind:value={form.webAnalyticsSiteTag} autocomplete="off" spellcheck="false" />
          <datalist id="sf-rum-list">
            {#if discovery?.webAnalytics.ok}{#each discovery.webAnalytics.items as w (w.siteTag)}<option value={w.siteTag}>{w.host ?? 'Web Analytics site'}</option>{/each}{/if}
          </datalist>
          <p class="hint">{#if discovery && !discovery.webAnalytics.ok}To pick from a list, add <b>Account Settings: Read</b> to the API token.{/if}
            For AI referral visits and Web Vitals.</p>
        </div>
        <div class="row">
          <label for="sf-brand">Brand regex</label>
          <input id="sf-brand" class="input mono" placeholder="acme|acme\s?corp" bind:value={form.brandRegex} autocomplete="off" spellcheck="false" />
          <p class="hint">Optional. Matching queries count as brand.</p>
        </div>
      </div>

      <div class="form-actions">
        <button class="btn primary" type="submit" disabled={saving || !form.domain.trim()}>
          <Icon name="check" size={14} /> {saving ? 'Saving…' : form.mode === 'create' ? 'Add site' : 'Save changes'}
        </button>
        <button class="btn ghost" type="button" onclick={() => (form = null)} disabled={saving}>Cancel</button>
      </div>
    </form>
  {/if}

  {#if configs.data}
    {#if configs.data.sites.length === 0}
      {#if !form}
        <EmptyState compact title="No sites yet" icon="globe">
          <p>Just the domain. Connect sources as you go.</p>
          {#snippet actions()}<button class="btn primary sm" onclick={openCreate}><Icon name="plus" size={14} /> Add site</button>{/snippet}
        </EmptyState>
      {/if}
    {:else}
      <ul class="sites">
        {#each configs.data.sites as s (s.id)}
          <li>
            <div class="who">
              <span class="domain">{s.domain}</span>
              <span class="id">{s.id}</span>
            </div>
            <div class="srcs">
              {#each SOURCES as src (src.key)}
                <Pill tone={s[src.key] ? 'ok' : 'neutral'} icon={s[src.key] ? 'check' : null}>{src.label}</Pill>
              {/each}
            </div>
            <div class="ops">
              {#if s.origin === 'dashboard'}
                <button class="btn ghost sm icon" onclick={() => openEdit(s)} aria-label="Edit {s.domain}" title="Edit"><Icon name="edit" size={14} /></button>
                <button class="btn ghost sm icon" onclick={() => remove(s)} aria-label="Remove {s.domain}" title="Remove"><Icon name="trash" size={14} /></button>
              {:else}
                <span class="from-secret" title="Defined in the SITES Worker secret; change it there.">SITES secret</span>
              {/if}
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  {:else if configs.error}
    <ErrorBanner error={configs.error} title="Could not load sites" />
  {:else}
    <Skeleton rows={2} />
  {/if}
</Card>

<style>
  .notice {
    display: flex;
    gap: 8px;
    align-items: flex-start;
    margin: 0 0 14px;
    padding: 10px 12px;
    border-radius: 8px;
    background: var(--accent-soft, color-mix(in srgb, var(--accent) 12%, transparent));
    color: var(--text-2, inherit);
    font-size: 13px;
  }
  .mb {
    margin-bottom: 14px;
  }
  .site-form {
    display: grid;
    gap: 16px;
    padding: 16px;
    margin-bottom: 16px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface-2, transparent);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 16px;
  }
  .row {
    display: grid;
    gap: 6px;
    min-width: 0;
    align-content: start;
  }
  label {
    font-size: 13px;
    font-weight: 550;
  }
  .req {
    font-weight: 400;
    font-size: 11px;
    color: var(--text-3, var(--muted));
    margin-left: 6px;
  }
  .with-btn {
    display: flex;
    gap: 8px;
  }
  .with-btn .input {
    flex: 1;
    min-width: 0;
  }
  .hint {
    margin: 0;
    font-size: 12px;
    color: var(--text-3, var(--muted));
    line-height: 1.45;
  }
  .mono {
    font-family: var(--font-mono, ui-monospace, monospace);
  }
  .form-actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .sites {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
  }
  .sites li {
    display: grid;
    grid-template-columns: minmax(160px, 1.2fr) 2fr auto;
    gap: 12px;
    align-items: center;
    padding: 12px 0;
    border-top: 1px solid var(--border);
  }
  .sites li:first-child {
    border-top: 0;
  }
  .who {
    display: grid;
    min-width: 0;
  }
  .domain {
    font-weight: 550;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .id {
    font-size: 12px;
    color: var(--text-3, var(--muted));
    font-family: var(--font-mono, ui-monospace, monospace);
  }
  .srcs {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .ops {
    display: flex;
    gap: 4px;
    justify-content: flex-end;
  }
  .from-secret {
    font-size: 12px;
    color: var(--text-3, var(--muted));
    white-space: nowrap;
  }
  @media (max-width: 720px) {
    .sites li {
      grid-template-columns: 1fr auto;
    }
    .srcs {
      grid-column: 1 / -1;
      grid-row: 2;
    }
  }
</style>

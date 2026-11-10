<script lang="ts">
  /**
   * Add, edit and remove the apps Searchkeep analyses (ADR 0009), and start App Store reports.
   * Apps from the APPS secret are shown read-only. Starting App Store reports takes a temporary
   * Admin key that the Worker uses for that one request and never stores.
   */
  import Card from './Card.svelte';
  import EmptyState from './EmptyState.svelte';
  import ErrorBanner from './ErrorBanner.svelte';
  import Icon from './Icon.svelte';
  import AppIcon from './AppIcon.svelte';
  import Pill from './Pill.svelte';
  import Skeleton from './Skeleton.svelte';
  import { request } from '../lib/api';
  import { refreshAll } from '../lib/resource.svelte';
  import { ui } from '../lib/state.svelte';
  import type { AppDiscoverResponse, AppInfo, EnableAppStoreResponse } from '../lib/types';

  interface Props {
    reloadSites: () => Promise<void>;
  }
  let { reloadSites }: Props = $props();

  let discovery = $state.raw<AppDiscoverResponse | null>(null);
  let discovering = $state(false);
  type Form = { mode: 'create' | 'edit'; id: string; name: string; appleId: string; playPackage: string; siteId: string; territories: string };
  const empty = (): Form => ({ mode: 'create', id: '', name: '', appleId: '', playPackage: '', siteId: '', territories: '' });
  let form = $state<Form | null>(null);
  let saving = $state(false);
  let error = $state.raw<unknown>(null);
  let notice = $state<string | null>(null);

  // The one-time "start App Store reports" form; its fields are cleared after every attempt.
  let enabling = $state<string | null>(null);
  let keyId = $state('');
  let issuerId = $state('');
  let privateKey = $state('');
  let snapshot = $state(true);
  let starting = $state(false);
  let started = $state.raw<EnableAppStoreResponse | null>(null);
  let startError = $state.raw<unknown>(null);

  async function loadDiscovery() {
    if (discovery || discovering) return;
    discovering = true;
    try {
      discovery = await request<AppDiscoverResponse>('/api/app-discover');
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

  function openEdit(a: AppInfo) {
    form = {
      mode: 'edit',
      id: a.id,
      name: a.name,
      appleId: a.appleId ?? '',
      playPackage: a.playPackage ?? '',
      siteId: a.siteId ?? '',
      territories: (a.territories ?? []).join(', '),
    };
    error = null;
    notice = null;
    void loadDiscovery();
  }

  async function save(e: SubmitEvent) {
    e.preventDefault();
    if (!form) return;
    saving = true;
    error = null;
    try {
      const body: Record<string, string> = { mode: form.mode, name: form.name };
      if (form.mode === 'edit') body.id = form.id;
      for (const k of ['appleId', 'playPackage', 'siteId', 'territories'] as const) if (form[k].trim()) body[k] = form[k].trim();
      const res = await request<{ app: { id: string; name: string }; created: boolean }>('/api/app-configs', {
        method: 'POST',
        body: JSON.stringify(body),
        contentType: 'application/json',
      });
      form = null;
      notice = res.created ? `Added ${res.app.name}. The next sync (within 15 minutes) starts pulling its store data; use Sync now to start right away.` : `Saved ${res.app.name}.`;
      refreshAll();
      await reloadSites();
      if (res.created) ui.setApp(res.app.id);
    } catch (err) {
      error = err;
    } finally {
      saving = false;
    }
  }

  async function remove(a: AppInfo) {
    if (!window.confirm(`Remove ${a.name} from Searchkeep? Data already synced stays in your database; add the app again to see it.`)) return;
    error = null;
    try {
      await request(`/api/app-configs/${encodeURIComponent(a.id)}`, { method: 'DELETE' });
      notice = `Removed ${a.name}.`;
      refreshAll();
      await reloadSites();
    } catch (err) {
      error = err;
    }
  }

  function openEnable(a: AppInfo) {
    enabling = a.id;
    started = null;
    startError = null;
    snapshot = !a.appStoreReports?.snapshot;
  }

  async function readKeyFile(e: Event) {
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    privateKey = await file.text();
    const m = /AuthKey_([A-Z0-9]+)\.p8$/i.exec(file.name);
    if (m && !keyId) keyId = m[1]!;
  }

  async function startReports(e: SubmitEvent) {
    e.preventDefault();
    if (!enabling) return;
    starting = true;
    startError = null;
    started = null;
    try {
      started = await request<EnableAppStoreResponse>(`/api/app-configs/${encodeURIComponent(enabling)}/enable-app-store`, {
        method: 'POST',
        body: JSON.stringify({ keyId: keyId.trim(), issuerId: issuerId.trim(), privateKey, snapshot }),
        contentType: 'application/json',
      });
      refreshAll();
      await reloadSites();
    } catch (err) {
      startError = err;
    } finally {
      // The Admin key is not kept around, whatever happened.
      privateKey = '';
      keyId = '';
      starting = false;
    }
  }

  function reportsPill(a: AppInfo): { tone: 'ok' | 'warn' | 'neutral'; text: string } {
    const r = a.appStoreReports;
    if (!a.appleId) return { tone: 'neutral', text: '' };
    if (!a.stores.appStore) return { tone: 'neutral', text: 'App Store Connect key not set' };
    if (!r?.started) return { tone: 'warn', text: 'Reports not started' };
    if (r.stopped) return { tone: 'warn', text: 'Reports stopped by Apple' };
    return { tone: 'ok', text: r.snapshot ? 'Reports and history' : 'Reports' };
  }
</script>

{#snippet appForm(f: Form)}
  <form class="app-form" onsubmit={save}>
    <div class="grid">
      <div class="row">
        <label for="af-name">Name <span class="req">required</span></label>
        <input id="af-name" class="input" type="text" placeholder="Acme" bind:value={f.name} autocomplete="off" required />
        <p class="hint">{f.mode === 'create' ? 'The id is made from it; it cannot change later.' : `Id: ${f.id}`}</p>
      </div>
      <div class="row">
        <label for="af-apple">App Store Apple ID</label>
        <input id="af-apple" class="input mono" list="af-apple-list" placeholder="1234567890" bind:value={f.appleId} autocomplete="off" spellcheck="false" />
        <datalist id="af-apple-list">
          {#if discovery?.appStore.ok}{#each discovery.appStore.items as a (a.id)}<option value={a.id}>{a.name} · {a.bundleId}</option>{/each}{/if}
        </datalist>
        <p class="hint">{discovery && !discovery.appStore.ok ? discovery.appStore.reason : 'App Store Connect → App Information → Apple ID, or the app’s App Store link.'}</p>
      </div>
      <div class="row">
        <label for="af-play">Google Play package</label>
        <input id="af-play" class="input mono" list="af-play-list" placeholder="com.example.app" bind:value={f.playPackage} autocomplete="off" spellcheck="false" />
        <datalist id="af-play-list">
          {#if discovery?.googlePlay.ok}{#each discovery.googlePlay.items as p (p.packageName)}<option value={p.packageName}>{p.name}</option>{/each}{/if}
        </datalist>
        <p class="hint">{discovery && !discovery.googlePlay.ok ? discovery.googlePlay.reason : 'Or the app’s Google Play link.'}</p>
      </div>
      <div class="row">
        <label for="af-site">Your site</label>
        <select id="af-site" class="select" bind:value={f.siteId}>
          <option value="">None</option>
          {#each ui.sites as s (s.id)}<option value={s.id}>{s.domain}</option>{/each}
        </select>
        <p class="hint">Optional. Referrals from it are marked as your own site.</p>
      </div>
      <div class="row">
        <label for="af-terr">Storefronts for public feeds</label>
        <input id="af-terr" class="input mono" placeholder="us, gb" bind:value={f.territories} autocomplete="off" spellcheck="false" />
        <p class="hint">Optional, up to 5. Used only when the opt-in public App Store feeds are on (APP_STORE_PUBLIC_DATA).</p>
      </div>
    </div>
    <div class="form-actions">
      <button class="btn primary" type="submit" disabled={saving || !f.name.trim() || (!f.appleId.trim() && !f.playPackage.trim())}>
        <Icon name="check" size={14} /> {saving ? 'Saving…' : f.mode === 'create' ? 'Add app' : 'Save changes'}
      </button>
      <button class="btn ghost" type="button" onclick={() => (form = null)} disabled={saving}>Cancel</button>
    </div>
  </form>
{/snippet}

<Card title="Apps" subtitle="Your iOS and Android apps. Their store data is kept apart from the sites." id="settings-apps">
  {#snippet actions()}
    {#if !form}
      <button class="btn primary sm" onclick={openCreate}><Icon name="plus" size={14} /> Add app</button>
    {/if}
  {/snippet}

  {#if notice}<p class="notice" role="status"><Icon name="info" size={14} /> {notice}</p>{/if}
  {#if error}<div class="mb"><ErrorBanner {error} title="Could not save the app" /></div>{/if}

  {#if form?.mode === 'create'}{@render appForm(form)}{/if}

  {#if ui.apps.length === 0}
    {#if !form}
      <EmptyState compact title="No apps yet" icon="plus">
        <p>Add the App Store Apple ID, the Google Play package name, or both.</p>
        {#snippet actions()}<button class="btn primary sm" onclick={openCreate}><Icon name="plus" size={14} /> Add app</button>{/snippet}
      </EmptyState>
    {/if}
  {:else}
    <ul class="apps">
      {#each ui.apps as a (a.id)}
        {@const pill = reportsPill(a)}
        <li class:editing={form?.mode === 'edit' && form.id === a.id}>
          <div class="who">
            <AppIcon app={a} size="lg" />
            <div class="names">
              <span class="name">{a.name}</span>
              <span class="id">{[a.appleId, a.playPackage].filter(Boolean).join(' · ')}</span>
            </div>
          </div>
          <div class="srcs">
            <Pill tone={a.stores.appStore ? 'ok' : 'neutral'} icon={a.stores.appStore ? 'check' : null}>App Store</Pill>
            <Pill tone={a.stores.googlePlay ? 'ok' : 'neutral'} icon={a.stores.googlePlay ? 'check' : null}>Google Play</Pill>
            {#if pill.text}<Pill tone={pill.tone}>{pill.text}</Pill>{/if}
          </div>
          <div class="ops">
            {#if a.appleId && a.stores.appStore}
              <button class="btn sm" onclick={() => openEnable(a)} title="Start or restart App Store reports, or request history">
                <Icon name="key" size={14} /> {a.appStoreReports?.started && !a.appStoreReports.stopped ? 'App Store reports' : 'Start App Store reports'}
              </button>
            {/if}
            {#if a.origin === 'dashboard'}
              <button class="btn ghost sm icon" onclick={() => openEdit(a)} aria-label="Edit {a.name}" title="Edit"><Icon name="edit" size={14} /></button>
              <button class="btn ghost sm icon" onclick={() => remove(a)} aria-label="Remove {a.name}" title="Remove"><Icon name="trash" size={14} /></button>
            {:else}
              <span class="from-secret" title="Defined in the APPS Worker secret; change it there.">APPS secret</span>
            {/if}
          </div>
          {#if form?.mode === 'edit' && form.id === a.id}<div class="inline-form">{@render appForm(form)}</div>{/if}
          {#if enabling === a.id}
            <form class="enable" onsubmit={startReports}>
              <div class="explain">
                <strong>Start App Store reports for {a.name}</strong>
                <p>
                  Apple generates analytics reports only after a request made with an <b>Admin</b> key. Create a temporary key in App Store Connect →
                  Users and Access → Integrations → Team Keys (role Admin), paste it here, then revoke it. Searchkeep sends it only to Apple, for this one
                  request, and never stores it. The daily sync keeps using your Sales and Reports key.
                </p>
              </div>
              <div class="grid">
                <div class="row">
                  <label for="ek-file">Key file (.p8)</label>
                  <input id="ek-file" class="input" type="file" accept=".p8" onchange={readKeyFile} />
                </div>
                <div class="row">
                  <label for="ek-id">Key ID</label>
                  <input id="ek-id" class="input mono" bind:value={keyId} autocomplete="off" spellcheck="false" placeholder="2X9R4HXF34" />
                </div>
                <div class="row">
                  <label for="ek-issuer">Issuer ID</label>
                  <input id="ek-issuer" class="input mono" bind:value={issuerId} autocomplete="off" spellcheck="false" placeholder="57246542-96fe-1a63-e053-0824d011072a" />
                </div>
              </div>
              <label class="check"><input type="checkbox" bind:checked={snapshot} /> Also request history back to January 2024 (one snapshot a month)</label>
              <div class="form-actions">
                <button class="btn primary" type="submit" disabled={starting || !keyId.trim() || !issuerId.trim() || !privateKey}>
                  <Icon name="key" size={14} /> {starting ? 'Starting…' : 'Start reports'}
                </button>
                <button class="btn ghost" type="button" onclick={() => (enabling = null)} disabled={starting}>Close</button>
              </div>
              {#if startError}<ErrorBanner error={startError} title="App Store reports were not started" />{/if}
              {#if started}
                <div class="done" role="status">
                  <p><Icon name="check" size={14} /> {started.ongoing.created ? 'Reports started.' : 'Reports were already running.'}{started.snapshot?.created ? ' History requested.' : ''}</p>
                  <ul>{#each started.notes as n (n)}<li>{n}</li>{/each}</ul>
                </div>
              {/if}
            </form>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
  {#if discovering && !discovery}<Skeleton rows={1} />{/if}
</Card>

<style>
  .notice {
    display: flex;
    gap: 8px;
    align-items: flex-start;
    margin: 0 0 14px;
    padding: 10px 12px;
    border-radius: 8px;
    background: var(--accent-wash);
    font-size: 13px;
  }
  .mb {
    margin-bottom: 14px;
  }
  .app-form,
  .enable {
    display: grid;
    gap: 16px;
    padding: 16px;
    margin-bottom: 16px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface-2);
  }
  .enable {
    grid-column: 1 / -1;
    margin: 4px 0 0;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
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
  .check {
    display: flex;
    gap: 8px;
    align-items: center;
    font-weight: 400;
  }
  .req {
    font-weight: 400;
    font-size: 11px;
    color: var(--text-3);
    margin-left: 6px;
  }
  .hint,
  .explain p {
    margin: 0;
    font-size: 12px;
    color: var(--text-3);
    line-height: 1.45;
  }
  .explain {
    display: grid;
    gap: 4px;
  }
  .mono {
    font-family: var(--mono);
  }
  .form-actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .done {
    font-size: 13px;
  }
  .done p {
    display: flex;
    gap: 6px;
    align-items: center;
    margin: 0 0 6px;
    font-weight: 550;
  }
  .done ul {
    margin: 0;
    padding-left: 18px;
    color: var(--text-2);
  }
  .apps {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
  }
  .apps li {
    display: grid;
    grid-template-columns: minmax(160px, 1.2fr) 2fr auto;
    gap: 12px;
    align-items: center;
    padding: 12px 0;
    border-top: 1px solid var(--border);
  }
  .apps li:first-child {
    border-top: 0;
  }
  .who {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }
  .names {
    display: grid;
    min-width: 0;
  }
  .name {
    font-weight: 550;
  }
  .inline-form {
    grid-column: 1 / -1;
  }
  .inline-form .app-form {
    margin: 4px 0 0;
  }
  .id {
    font-size: 12px;
    color: var(--text-3);
    font-family: var(--mono);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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
    align-items: center;
  }
  .from-secret {
    font-size: 12px;
    color: var(--text-3);
    white-space: nowrap;
  }
  @media (max-width: 720px) {
    .apps li {
      grid-template-columns: 1fr;
    }
    .ops {
      justify-content: flex-start;
      flex-wrap: wrap;
    }
  }
</style>

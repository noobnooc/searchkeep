<script lang="ts">
  // What the deployment has set up: Access, secrets, connections to each source, and the sync.
  import Card from '../../components/Card.svelte';
  import ErrorBanner from '../../components/ErrorBanner.svelte';
  import Icon from '../../components/Icon.svelte';
  import Pill from '../../components/Pill.svelte';
  import Segmented from '../../components/Segmented.svelte';
  import Skeleton from '../../components/Skeleton.svelte';
  import type { Resource } from '../../lib/resource.svelte';
  import type { CheckStatus, SetupStatusResponse } from '../../lib/types';

  interface Props {
    setup: Resource<SetupStatusResponse>;
  }
  let { setup }: Props = $props();

  const GROUPS: Array<{ prefix: string; title: string; about: string }> = [
    { prefix: 'readiness.', title: 'Access', about: 'Cloudflare Access protects the dashboard and the MCP endpoint.' },
    { prefix: 'config', title: 'Configuration', about: 'Worker Secrets: credentials for each source.' },
    { prefix: 'probe.', title: 'Connections', about: 'Live calls to each source with the configured credentials.' },
    { prefix: 'sync.', title: 'Sync', about: 'The scheduled sync and how far it has come.' },
  ];
  type Filter = 'all' | 'problems';
  let filter = $state<Filter>('all');
  const checks = $derived(setup.data?.checks ?? []);
  const problems = $derived(checks.filter((c) => c.status === 'error' || c.status === 'warn').length);
  const grouped = $derived(
    GROUPS.map((g) => ({
      ...g,
      checks: checks.filter((c) => c.id.startsWith(g.prefix) && (filter === 'all' || c.status === 'error' || c.status === 'warn')),
    })).filter((g) => g.checks.length > 0),
  );
  const tone = (s: CheckStatus) => (s === 'ok' ? 'ok' : s === 'warn' ? 'warn' : s === 'error' ? 'error' : 'neutral') as 'ok' | 'warn' | 'error' | 'neutral';
  const STATUS_LABEL: Record<CheckStatus, string> = { ok: 'OK', warn: 'Check', error: 'Fix', skipped: 'Skipped' };
  const toFix = $derived(checks.filter((c) => c.status === 'error').length);
  const toCheck = $derived(checks.filter((c) => c.status === 'warn').length);
  const summary = $derived(problems === 0 ? 'All OK' : [toFix ? `${toFix} to fix` : '', toCheck ? `${toCheck} to check` : ''].filter(Boolean).join(' · '));
</script>

<Card title="Setup checks" subtitle="What this deployment has set up. Run the checks again after you change a secret or an Access setting." id="settings-checks" busy={setup.loading && Boolean(setup.data)}>
  {#snippet actions()}
    {#if setup.data}<Pill tone={toFix ? 'error' : toCheck ? 'warn' : 'ok'} title={setup.data.summary}>{summary}</Pill>{/if}
    <button class="btn ghost sm icon" onclick={setup.reload} aria-label="Run checks again" title="Run checks again"><Icon name="refresh" size={14} /></button>
  {/snippet}
  {#if setup.error}
    <ErrorBanner error={setup.error} retry={setup.reload} />
  {:else if !setup.data}
    <Skeleton kind="table" rows={8} />
  {:else}
    {#if problems > 0}
      <div class="filter">
        <Segmented
          label="Show"
          size="sm"
          options={[
            { value: 'all', label: `All ${checks.length}` },
            { value: 'problems', label: `To fix or check ${problems}` },
          ]}
          value={filter}
          onchange={(v: Filter) => (filter = v)} />
      </div>
    {/if}
    <div class="groups">
      {#each grouped as g (g.title)}
        <section>
          <header>
            <h3>{g.title}</h3>
            <p>{g.about}</p>
          </header>
          <ul class="checks">
            {#each g.checks as c, i (`${c.id}-${i}`)}
              <li class={c.status}>
                <Pill tone={tone(c.status)}>{STATUS_LABEL[c.status]}</Pill>
                <div>
                  <span class="label">{c.label}</span>
                  {#if c.detail}<span class="detail">{c.detail}</span>{/if}
                </div>
              </li>
            {/each}
          </ul>
        </section>
      {/each}
    </div>
  {/if}
</Card>

<style>
  .filter {
    margin-bottom: 14px;
  }
  /* Columns, so a short group does not leave a gap next to a long one. */
  .groups {
    columns: 2 340px;
    column-gap: 28px;
  }
  section {
    min-width: 0;
    break-inside: avoid;
    padding-bottom: 20px;
  }
  header {
    margin-bottom: 10px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--border);
  }
  h3 {
    font-family: var(--mono);
    font-size: 10.5px;
    font-weight: 500;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-3);
    margin: 0 0 2px;
  }
  header p {
    margin: 0;
    font-size: 12px;
    color: var(--text-3);
  }
  .checks {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 9px;
  }
  .checks li {
    display: grid;
    grid-template-columns: 64px minmax(0, 1fr);
    align-items: start;
    gap: 10px;
    font-size: 13px;
  }
  .checks li > :global(.pill) {
    justify-self: start;
  }
  .label {
    display: block;
  }
  .error .label {
    font-weight: 550;
  }
  .detail {
    display: block;
    font-size: 12.5px;
    color: var(--text-3);
    overflow-wrap: anywhere;
  }
</style>

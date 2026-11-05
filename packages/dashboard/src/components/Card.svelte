<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    title?: string;
    subtitle?: string;
    /** The subtitle comes from data that is still loading: hold its line with a skeleton. */
    subtitlePending?: boolean;
    /** Right side of the header (controls, links). */
    actions?: Snippet;
    footer?: Snippet;
    children: Snippet;
    flush?: boolean;
    id?: string;
    class?: string;
    busy?: boolean;
  }
  let { title, subtitle, subtitlePending = false, actions, footer, children, flush = false, id, class: className = '', busy = false }: Props = $props();
</script>

<section class="card {className}" {id} aria-busy={busy}>
  {#if title || actions}
    <header class="card-head">
      <div class="titles">
        {#if title}<h2>{title}</h2>{/if}
        {#if subtitle}<p>{subtitle}</p>{:else if subtitlePending}<p><span class="skel sub-skel" aria-hidden="true"></span></p>{/if}
      </div>
      {#if actions}<div class="actions">{@render actions()}</div>{/if}
    </header>
  {/if}
  <div class="card-body" class:flush class:refetching={busy}>
    {@render children()}
  </div>
  {#if footer}<footer class="card-foot">{@render footer()}</footer>{/if}
</section>

<style>
  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: var(--shadow-card);
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .card-head {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 14px 16px 0;
    flex-wrap: wrap;
  }
  .titles {
    flex: 1 1 200px;
    min-width: 0;
  }
  h2 {
    font-size: 13.5px;
    font-weight: 600;
    letter-spacing: -0.005em;
    color: var(--text);
    line-height: 1.4;
  }
  .titles p {
    margin-top: 2px;
    font-size: 12.5px;
    color: var(--text-3);
  }
  .sub-skel {
    display: inline-block;
    vertical-align: middle;
    width: 150px;
    height: 10px;
    border-radius: 4px;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    min-width: 0;
    max-width: 100%;
  }
  .card-body {
    padding: 14px 16px 16px;
    min-width: 0;
    flex: 1;
  }
  .card-body.flush {
    padding: 10px 0 0;
  }
  .card-foot {
    padding: 10px 16px 12px;
    border-top: 1px solid var(--border);
    font-size: 12.5px;
    color: var(--text-3);
  }
  /* A footer whose content rendered nothing (e.g. no notes) takes no space. */
  .card-foot:not(:has(*)) {
    display: none;
  }
</style>

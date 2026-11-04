<script lang="ts">
  import type { Snippet } from 'svelte';
  import { ui } from '../lib/state.svelte';
  import type { Brand, Source } from '../lib/types';
  import DateRangePicker from './DateRangePicker.svelte';
  import Segmented from './Segmented.svelte';

  interface Props {
    title: string;
    description?: string;
    /** Resolved range etc., shown under the title. */
    meta?: string;
    /** Which global filters this view uses. */
    source?: boolean | 'gsc-only';
    brand?: boolean;
    range?: boolean;
    /** Extra controls before the global filters. */
    controls?: Snippet;
  }
  let { title, description, meta, source = false, brand = false, range = true, controls }: Props = $props();

  const SOURCES: Array<{ value: Source; label: string; title?: string; disabled?: boolean }> = [
    { value: 'gsc', label: 'Google' },
    { value: 'bing', label: 'Bing' },
  ];
  const BRANDS: Array<{ value: Brand; label: string }> = [
    { value: 'all', label: 'All queries' },
    { value: 'brand', label: 'Brand' },
    { value: 'non_brand', label: 'Non-brand' },
  ];
  const sourceOptions = $derived(
    source === 'gsc-only' ? SOURCES.map((o) => (o.value === 'bing' ? { ...o, disabled: true, title: 'Needs query × page data, which only Search Console provides' } : o)) : SOURCES,
  );
</script>

<header class="page-head">
  <div class="titles">
    <h1>{title}</h1>
    {#if description || meta}
      <p>
        {#if description}<span>{description}</span>{/if}
        {#if meta}<span class="meta num">{meta}</span>{/if}
      </p>
    {/if}
  </div>
  <div class="filters" role="group" aria-label="Filters">
    {#if controls}{@render controls()}{/if}
    {#if source}
      <Segmented label="Search engine" options={sourceOptions} value={source === 'gsc-only' ? 'gsc' : ui.source} onchange={(v) => ui.setSource(v)} disabled={source === 'gsc-only'} />
    {/if}
    {#if brand}
      <Segmented label="Brand filter" options={BRANDS} value={ui.brand} onchange={(v) => ui.setBrand(v)} />
    {/if}
    {#if range}<DateRangePicker />{/if}
  </div>
</header>

<style>
  .page-head {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 12px 24px;
    flex-wrap: wrap;
    margin-bottom: 20px;
  }
  .titles {
    min-width: 0;
    flex: 1 1 260px;
  }
  h1 {
    font-family: var(--display);
    font-size: 22px;
    line-height: 1.25;
    font-weight: 600;
    letter-spacing: -0.02em;
  }
  p {
    margin-top: 3px;
    display: flex;
    flex-wrap: wrap;
    gap: 2px 10px;
    color: var(--text-3);
    font-size: 13px;
  }
  .meta {
    color: var(--text-2);
  }
  .filters {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    max-width: 100%;
  }
  @media (max-width: 640px) {
    .page-head {
      margin-bottom: 16px;
    }
    h1 {
      font-size: 18px;
    }
  }
</style>

<script lang="ts" generics="T">
  import { compareValues, type Column, type SortState } from '../lib/table';
  import Icon from './Icon.svelte';

  interface Props {
    rows: T[];
    columns: Column<T>[];
    /** Current sort; bindable for client-side sorting. */
    sort?: SortState | null;
    /** When set, sorting is done by the caller (server-side) and rows are shown as given. */
    onsort?: (s: SortState) => void;
    rowKey?: (row: T, i: number) => string;
    /** Rows shown before "Show all". */
    limit?: number;
    label: string;
    rowClass?: (row: T) => string;
    maxHeight?: string;
  }
  let { rows, columns, sort = $bindable(null), onsort, rowKey, limit, label, rowClass, maxHeight }: Props = $props();

  let expanded = $state(false);

  const read = (row: T, key: string): unknown => (row as Record<string, unknown>)[key];

  const sorted = $derived.by(() => {
    if (!sort || onsort) return rows;
    const s = sort;
    const col = columns.find((c) => c.key === s.key);
    if (!col) return rows;
    const get = col.sortValue ?? ((r: T) => read(r, col.key) as number | string | null | undefined);
    const dir = s.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = get(a);
      const vb = get(b);
      // Empty values always sink to the bottom.
      if ((va === null || va === undefined) !== (vb === null || vb === undefined)) return compareValues(va, vb);
      return compareValues(va, vb) * dir;
    });
  });
  const visible = $derived(limit && !expanded ? sorted.slice(0, limit) : sorted);

  function toggle(col: Column<T>) {
    const dir = sort?.key === col.key ? (sort.dir === 'desc' ? 'asc' : 'desc') : col.align === 'right' ? 'desc' : 'asc';
    const next: SortState = { key: col.key, dir };
    if (onsort) onsort(next);
    else sort = next;
  }

  function text(row: T, col: Column<T>): string {
    if (col.text) return col.text(row);
    const v = read(row, col.key);
    return v === null || v === undefined ? '—' : String(v);
  }
</script>

<div class="wrap" style:max-height={maxHeight}>
  <table aria-label={label}>
    <thead>
      <tr>
        {#each columns as col (col.key)}
          <th
            class:right={col.align === 'right'}
            class:grow={col.grow}
            class:hide-sm={col.hideOnMobile}
            style:width={col.width}
            aria-sort={sort?.key === col.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
            title={col.title}>
            {#if col.sortable}
              <button class="th-btn" class:active={sort?.key === col.key} onclick={() => toggle(col)}>
                <span>{col.label}</span>
                <span class="sort-ind" aria-hidden="true">
                  {#if sort?.key === col.key}
                    <Icon name={sort.dir === 'asc' ? 'arrowUp' : 'arrowDown'} size={11} stroke={2.25} />
                  {/if}
                </span>
              </button>
            {:else}
              <span class="th-label">{col.label}</span>
            {/if}
          </th>
        {/each}
      </tr>
    </thead>
    <tbody>
      {#each visible as row, i (rowKey ? rowKey(row, i) : i)}
        <tr class={rowClass?.(row) ?? ''}>
          {#each columns as col (col.key)}
            {@const bar = col.bar?.(row)}
            <td class:right={col.align === 'right'} class:grow={col.grow} class:hide-sm={col.hideOnMobile} class:num={col.align === 'right'}>
              {#if col.render}
                {@render col.render(row)}
              {:else}
                {text(row, col)}
              {/if}
              {#if bar}
                <span class="cell-bar" aria-hidden="true"
                  ><span style:width="{bar.max > 0 ? Math.max(bar.value > 0 ? 3 : 0, (bar.value / bar.max) * 100) : 0}%" style:background={bar.color ?? 'var(--accent)'}></span></span>
              {/if}
            </td>
          {/each}
        </tr>
      {/each}
    </tbody>
  </table>
</div>
{#if limit && sorted.length > limit}
  <div class="more">
    <button class="btn ghost sm" onclick={() => (expanded = !expanded)}>
      {expanded ? 'Show fewer' : `Show all ${sorted.length.toLocaleString('en-US')} rows`}
      <Icon name={expanded ? 'arrowUp' : 'chevronDown'} size={13} />
    </button>
  </div>
{/if}

<style>
  .wrap {
    width: 100%;
    overflow: auto;
    overscroll-behavior-x: contain;
  }
  table {
    width: 100%;
    border-collapse: separate;
    border-spacing: 0;
    font-size: 13px;
  }
  th {
    position: sticky;
    top: 0;
    z-index: 1;
    background: var(--surface);
    text-align: left;
    font-weight: 500;
    font-size: 12px;
    color: var(--text-3);
    padding: 0 12px;
    height: 34px;
    border-bottom: 1px solid var(--border);
    white-space: nowrap;
  }
  th:first-child,
  td:first-child {
    padding-left: 16px;
  }
  th:last-child,
  td:last-child {
    padding-right: 16px;
  }
  th.right {
    text-align: right;
  }
  .th-btn {
    all: unset;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 3px;
    border-radius: 4px;
  }
  th.right .th-btn {
    flex-direction: row-reverse;
  }
  .th-btn:hover,
  .th-btn.active {
    color: var(--text);
  }
  .th-btn:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .sort-ind {
    display: inline-flex;
    width: 11px;
  }
  td {
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
    vertical-align: middle;
    color: var(--text);
    white-space: nowrap;
    position: relative;
  }
  td.grow {
    white-space: normal;
    min-width: 200px;
    max-width: 520px;
    overflow-wrap: anywhere;
    width: 100%;
  }
  td.right {
    text-align: right;
  }
  tbody tr:last-child td {
    border-bottom: 0;
  }
  tbody tr:hover td {
    background: var(--neutral-wash);
  }
  .cell-bar {
    display: block;
    height: 3px;
    margin-top: 5px;
    border-radius: 2px;
    background: var(--neutral-wash);
    overflow: hidden;
    min-width: 56px;
  }
  .cell-bar > span {
    display: block;
    height: 100%;
    border-radius: 2px;
  }
  td.right .cell-bar {
    margin-left: auto;
  }
  .more {
    display: flex;
    justify-content: center;
    padding: 8px;
    border-top: 1px solid var(--border);
  }
  @media (max-width: 640px) {
    .hide-sm {
      display: none;
    }
    td.grow {
      min-width: 150px;
    }
    th,
    td {
      padding-left: 10px;
      padding-right: 10px;
    }
    .cell-bar {
      min-width: 44px;
    }
  }
</style>

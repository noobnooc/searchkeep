<script lang="ts">
  interface Tab {
    id: string;
    label: string;
    href: string;
    count?: number | null;
  }
  interface Props {
    tabs: Tab[];
    active: string;
    label: string;
  }
  let { tabs, active, label }: Props = $props();
</script>

<nav class="tabs" aria-label={label}>
  {#each tabs as t (t.id)}
    <a href={t.href} aria-current={t.id === active ? 'page' : undefined}>
      {t.label}
      {#if t.count !== undefined && t.count !== null}<span class="count num">{t.count}</span>{/if}
    </a>
  {/each}
</nav>

<style>
  .tabs {
    display: flex;
    gap: 2px;
    border-bottom: 1px solid var(--border);
    overflow-x: auto;
    scrollbar-width: none;
    margin-bottom: 16px;
  }
  .tabs::-webkit-scrollbar {
    display: none;
  }
  a {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 10px 10px;
    color: var(--text-2);
    font-size: 13px;
    font-weight: 500;
    white-space: nowrap;
  }
  a:hover {
    color: var(--text);
    text-decoration: none;
  }
  a[aria-current='page'] {
    color: var(--text);
  }
  a[aria-current='page']::after {
    content: '';
    position: absolute;
    left: 8px;
    right: 8px;
    bottom: -1px;
    height: 2px;
    border-radius: 2px;
    background: var(--accent);
  }
  .count {
    font-size: 11px;
    padding: 0 6px;
    border-radius: 999px;
    background: var(--neutral-wash);
    color: var(--text-2);
    line-height: 18px;
  }
</style>

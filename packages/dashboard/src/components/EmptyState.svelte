<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon, { type IconName } from './Icon.svelte';

  interface Props {
    title: string;
    icon?: IconName;
    children?: Snippet;
    actions?: Snippet;
    compact?: boolean;
  }
  let { title, icon = 'sparkle', children, actions, compact = false }: Props = $props();
</script>

<div class="empty" class:compact role="status">
  <div class="glyph"><Icon name={icon} size={18} /></div>
  <h3>{title}</h3>
  {#if children}<div class="body">{@render children()}</div>{/if}
  {#if actions}<div class="actions">{@render actions()}</div>{/if}
</div>

<style>
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    padding: 40px 20px;
    gap: 8px;
  }
  .empty.compact {
    padding: 24px 16px;
  }
  .glyph {
    width: 36px;
    height: 36px;
    border-radius: 9px;
    display: grid;
    place-items: center;
    color: var(--text-2);
    background: var(--surface-2);
    border: 1px solid var(--border-2);
    margin-bottom: 4px;
  }
  h3 {
    font-family: var(--display);
    font-size: 15px;
    font-weight: 600;
    letter-spacing: -0.01em;
  }
  .body {
    max-width: 460px;
    font-size: 13px;
    color: var(--text-2);
    line-height: 1.6;
  }
  .body :global(p + p) {
    margin-top: 6px;
  }
  .actions {
    display: flex;
    gap: 8px;
    margin-top: 8px;
    flex-wrap: wrap;
    justify-content: center;
  }
</style>

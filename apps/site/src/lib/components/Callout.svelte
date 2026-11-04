<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon, { type IconName } from './Icon.svelte';

  let {
    kind = 'note',
    title,
    children,
  }: { kind?: 'note' | 'human' | 'warning' | 'agent'; title?: string; children: Snippet } = $props();

  const meta: Record<string, { icon: IconName; label: string }> = {
    note: { icon: 'sparkle', label: 'Note' },
    human: { icon: 'user', label: 'Human step' },
    warning: { icon: 'shield', label: 'Important' },
    agent: { icon: 'terminal', label: 'Agent can do this' },
  };
  const m = $derived(meta[kind]!);
</script>

<aside class="callout {kind}" aria-label={title ?? m.label}>
  <div class="head">
    <Icon name={m.icon} size={15} />
    <span>{title ?? m.label}</span>
  </div>
  <div class="body">{@render children()}</div>
</aside>

<style>
  .callout {
    --c: var(--text-2);
    --bgc: var(--surface-2);
    --bc: var(--line-2);
    padding: 14px 16px;
    border: 1px solid var(--bc);
    border-radius: var(--radius);
    background: var(--bgc);
    font-size: 0.9375rem;
    line-height: 1.6;
  }
  .human {
    --c: var(--warn);
    --bgc: var(--warn-soft);
    --bc: light-dark(oklch(0.6 0.13 75 / 0.35), oklch(0.83 0.14 80 / 0.25));
  }
  .warning {
    --c: var(--bad);
    --bgc: var(--bad-soft);
    --bc: light-dark(oklch(0.55 0.17 25 / 0.3), oklch(0.74 0.15 25 / 0.25));
  }
  /* Agent notes are cool blue, so they never read as the amber "human" step. */
  .agent {
    --c: var(--cool);
    --bgc: color-mix(in oklch, var(--cool) 9%, transparent);
    --bc: color-mix(in oklch, var(--cool) 32%, transparent);
  }
  .note {
    --c: var(--text);
    --bgc: var(--surface-2);
    --bc: var(--line-2);
  }
  .head {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--c);
    margin-bottom: 4px;
  }
  .body {
    color: var(--text-2);
  }
  .body :global(> * + *) {
    margin-top: 0.6em;
  }
</style>

<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon, { type IconName } from './Icon.svelte';

  type Tone = 'ok' | 'warn' | 'error' | 'neutral' | 'accent';
  interface Props {
    tone?: Tone;
    icon?: IconName | 'auto' | null;
    children: Snippet;
    title?: string;
  }
  let { tone = 'neutral', icon = 'auto', children, title }: Props = $props();
  const AUTO: Record<Tone, IconName | null> = { ok: 'check', warn: 'alert', error: 'x', neutral: null, accent: null };
  const ic = $derived(icon === 'auto' ? AUTO[tone] : icon);
</script>

<span class="pill {tone}" {title}>
  {#if ic}<Icon name={ic} size={11} stroke={2.25} />{/if}
  {@render children()}
</span>

<style>
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 20px;
    padding: 0 7px;
    border-radius: 999px;
    font-size: 11.5px;
    font-weight: 500;
    white-space: nowrap;
    line-height: 1;
    border: 1px solid transparent;
  }
  .ok {
    color: var(--pos);
    background: var(--pos-wash);
  }
  .warn {
    color: var(--warn);
    background: var(--warn-wash);
  }
  .error {
    color: var(--neg);
    background: var(--neg-wash);
  }
  .neutral {
    color: var(--text-2);
    background: var(--neutral-wash);
  }
  .accent {
    color: var(--accent-text);
    background: var(--accent-wash);
  }
</style>

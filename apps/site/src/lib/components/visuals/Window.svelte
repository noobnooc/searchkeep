<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    title,
    label,
    children,
    tone = 'default',
  }: { title?: string; label: string; children: Snippet; tone?: 'default' | 'terminal' } = $props();
</script>

<figure class="window {tone}" role="img" aria-label={label}>
  <div class="chrome" aria-hidden="true">
    <span class="dots"><i></i><i></i><i></i></span>
    {#if title}<span class="title">{title}</span>{/if}
    <span class="spacer"></span>
  </div>
  <div class="content" aria-hidden="true">
    {@render children()}
  </div>
</figure>

<style>
  .window {
    position: relative;
    border-radius: var(--radius-lg);
    border: 1px solid var(--line-2);
    background: var(--bg-elev);
    box-shadow: var(--shadow-lg);
    overflow: hidden;
    isolation: isolate;
  }
  .window::before {
    /* top sheen */
    content: '';
    position: absolute;
    inset: 0 0 auto;
    height: 1px;
    background: linear-gradient(90deg, transparent, light-dark(rgb(255 255 255 / 0.9), rgb(255 255 255 / 0.16)), transparent);
    z-index: 2;
  }
  .chrome {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    height: 38px;
    padding-inline: 14px;
    border-bottom: 1px solid var(--line);
    background: light-dark(#fafaf9, #0f1012);
  }
  .dots {
    display: flex;
    gap: 6px;
  }
  .dots i {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--surface-3);
    border: 1px solid var(--line);
  }
  .title {
    font-size: 12px;
    color: var(--text-3);
    font-family: var(--font-mono);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .content {
    position: relative;
  }
  .terminal {
    background: var(--code-bg);
  }
</style>

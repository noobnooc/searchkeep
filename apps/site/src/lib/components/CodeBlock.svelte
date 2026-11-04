<script lang="ts">
  import { highlight, type Lang } from '../highlight';
  import Icon from './Icon.svelte';

  let {
    code,
    lang = 'text',
    title,
    copy = true,
    wrap = false,
  }: { code: string; lang?: Lang; title?: string; copy?: boolean; wrap?: boolean } = $props();

  const html = $derived(highlight(code.replace(/^\n+|\s+$/g, ''), lang));
  const label = $derived(
    title ?? ({ bash: 'Terminal', json: 'JSON', jsonc: 'JSONC', ts: 'TypeScript', http: 'HTTP', regex: 'Regex', text: '' } as const)[lang]
  );
</script>

<div class="code" class:wrap data-code>
  {#if label || copy}
    <div class="bar">
      <span class="title">{label}</span>
      {#if copy}
        <button type="button" class="copy" data-copy hidden aria-label="Copy code">
          <span class="i-copy"><Icon name="copy" size={14} /></span>
          <span class="i-check"><Icon name="check" size={14} /></span>
        </button>
      {/if}
    </div>
  {/if}
  <!-- Scrollable code must be reachable by keyboard (WCAG 2.1.1 / axe scrollable-region-focusable). -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <pre tabindex="0"><code>{@html html}</code></pre>
</div>

<style>
  .code {
    position: relative;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--code-bg);
    overflow: hidden;
    min-width: 0;
  }
  .bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    height: 36px;
    padding-inline: 14px 6px;
    border-bottom: 1px solid var(--line);
    font-size: var(--fs-xs);
    color: var(--text-3);
    font-family: var(--font-mono);
  }
  .title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  pre {
    margin: 0;
    padding: 14px 16px 16px;
    overflow-x: auto;
    font-size: 0.8125rem;
    line-height: 1.7;
    color: var(--text-2);
    tab-size: 2;
  }
  /* Prose-like blocks (prompts) wrap instead of scrolling sideways. */
  .wrap pre {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  pre:focus-visible {
    outline-offset: -2px;
  }
  code {
    font-size: inherit;
  }
  .copy {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border: 1px solid transparent;
    border-radius: 7px;
    background: transparent;
    color: var(--text-3);
    transition: color 150ms, background-color 150ms, border-color 150ms;
  }
  .copy:hover {
    color: var(--text);
    background: var(--surface-2);
    border-color: var(--line);
  }
  .i-check {
    display: none;
    color: var(--accent);
  }
  .copy:global([data-state='copied']) .i-copy {
    display: none;
  }
  .copy:global([data-state='copied']) .i-check {
    display: block;
  }
</style>

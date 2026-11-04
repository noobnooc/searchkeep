<script lang="ts">
  // The two-line "paste into your agent" panel: the prompt, a copy button (wired by static/site.js
  // through data-code / data-copy), and what the agent needs to have access to.
  import Icon from './Icon.svelte';
  import { AGENT_PREREQS, AGENT_PROMPT } from '../content';
</script>

<div class="agent-prompt" data-code>
  <div class="head">
    <span class="label">Paste into your agent</span>
    <span class="needs">
      {#each AGENT_PREREQS as p (p.title)}
        <span class="need" title="{p.title}: {p.text}"><Icon name={p.icon} size={14} /><span class="visually-hidden">{p.title}</span></span>
      {/each}
      <span class="req">Required</span>
    </span>
  </div>
  <div class="body">
    <code>{AGENT_PROMPT}</code>
    <button type="button" class="copy" data-copy hidden aria-label="Copy prompt">
      <span class="i-copy"><Icon name="copy" size={15} /></span>
      <span class="i-check"><Icon name="check" size={15} /></span>
    </button>
  </div>
</div>

<style>
  .agent-prompt {
    border: 1px solid var(--line-2);
    border-radius: var(--radius-lg);
    background: var(--bg-elev);
    overflow: hidden;
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 14px;
    border-bottom: 1px solid var(--line);
  }
  .label,
  .req {
    font-family: var(--font-mono);
    font-size: 0.6875rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-3);
  }
  .needs {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .need {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border-radius: 6px;
    border: 1px solid var(--line-2);
    color: var(--text-2);
  }
  .req {
    margin-left: 2px;
  }
  .body {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 14px 14px 14px 16px;
  }
  code {
    flex: 1;
    min-width: 0;
    padding: 0;
    border: 0;
    background: none;
    font-size: 0.8125rem;
    line-height: 1.65;
    color: var(--text);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .copy {
    flex: none;
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border: 1px solid var(--line-2);
    border-radius: 8px;
    background: var(--surface);
    color: var(--text-2);
    cursor: pointer;
  }
  .copy:hover {
    color: var(--text);
    border-color: var(--line-3);
  }
  .i-check {
    display: none;
  }
  .copy:global([data-state='copied']) .i-copy {
    display: none;
  }
  .copy:global([data-state='copied']) .i-check {
    display: block;
    color: var(--signal);
  }
</style>

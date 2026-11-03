<script lang="ts" generics="V extends string">
  interface Option {
    value: V;
    label: string;
    disabled?: boolean;
    title?: string;
  }
  interface Props {
    options: Option[];
    value: V;
    onchange: (v: V) => void;
    label: string;
    size?: 'sm' | 'md';
    disabled?: boolean;
  }
  let { options, value, onchange, label, size = 'md', disabled = false }: Props = $props();

  function onkeydown(e: KeyboardEvent) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const enabled = options.filter((o) => !o.disabled);
    const i = enabled.findIndex((o) => o.value === value);
    const next = enabled[(i + (e.key === 'ArrowRight' ? 1 : -1) + enabled.length) % enabled.length];
    if (next) {
      e.preventDefault();
      onchange(next.value);
      const group = e.currentTarget as HTMLElement;
      requestAnimationFrame(() => group.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus());
    }
  }
</script>

<div class="seg {size}" class:disabled role="radiogroup" aria-label={label} tabindex="-1" {onkeydown}>
  {#each options as o (o.value)}
    <button
      type="button"
      role="radio"
      aria-checked={o.value === value}
      tabindex={o.value === value ? 0 : -1}
      disabled={disabled || o.disabled}
      title={o.title}
      onclick={() => onchange(o.value)}>{o.label}</button>
  {/each}
</div>

<style>
  .seg {
    display: inline-flex;
    align-items: center;
    padding: 2px;
    gap: 2px;
    border-radius: 8px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    max-width: 100%;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .seg::-webkit-scrollbar {
    display: none;
  }
  .seg:focus {
    outline: none;
  }
  button {
    height: 26px;
    padding: 0 10px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--text-2);
    font-size: 12.5px;
    font-weight: 500;
    white-space: nowrap;
    transition:
      background 120ms ease,
      color 120ms ease;
  }
  .sm button {
    height: 22px;
    padding: 0 8px;
    font-size: 12px;
  }
  button:hover:not(:disabled) {
    color: var(--text);
  }
  button[aria-checked='true'] {
    background: var(--surface);
    color: var(--text);
    box-shadow:
      0 0 0 1px var(--border-2),
      0 1px 2px rgba(0, 0, 0, 0.15);
  }
  button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .disabled {
    opacity: 0.6;
  }
</style>

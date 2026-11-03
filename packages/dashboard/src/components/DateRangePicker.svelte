<script lang="ts">
  import { dismissable } from '../lib/dismiss';
  import { isoDate, rangeLabel } from '../lib/format';
  import { PRESETS, ui } from '../lib/state.svelte';
  import Icon from './Icon.svelte';

  interface Props {
    disabled?: boolean;
    title?: string;
  }
  let { disabled = false, title }: Props = $props();

  let open = $state(false);
  let start = $state(ui.customStart);
  let end = $state(ui.customEnd);
  const today = isoDate(new Date());
  const valid = $derived(Boolean(start && end && start <= end && end <= today));

  const label = $derived(ui.preset === 'custom' && ui.customStart && ui.customEnd ? rangeLabel({ start: ui.customStart, end: ui.customEnd }) : ui.rangeLabel);

  function toggle() {
    open = !open;
    if (open) {
      start = ui.customStart || ui.absoluteRange()?.start || '';
      end = ui.customEnd || ui.absoluteRange()?.end || '';
    }
  }

  function apply() {
    if (!valid) return;
    ui.setCustom(start, end);
    open = false;
  }
</script>

<div class="drp" {@attach dismissable(() => open, () => (open = false))}>
  <button class="btn trigger" aria-haspopup="dialog" aria-expanded={open} onclick={toggle} {disabled} {title}>
    <Icon name="calendar" size={14} />
    <span class="num">{label}</span>
    <Icon name="chevronDown" size={13} class="chev" />
  </button>
  {#if open}
    <div class="pop" role="dialog" aria-label="Choose a date range">
      <ul class="presets">
        {#each PRESETS as p (p.id)}
          <li>
            <button
              class="preset"
              aria-pressed={ui.preset === p.id}
              onclick={() => {
                ui.setPreset(p.id);
                open = false;
              }}>
              <span class="check">{#if ui.preset === p.id}<Icon name="check" size={14} stroke={2.5} />{/if}</span>
              {p.label}
            </button>
          </li>
        {/each}
      </ul>
      <form
        class="custom"
        onsubmit={(e) => {
          e.preventDefault();
          apply();
        }}>
        <div class="custom-title">
          <span class="check">{#if ui.preset === 'custom'}<Icon name="check" size={14} stroke={2.5} />{/if}</span>
          Custom range
        </div>
        <div class="dates">
          <label><span class="sr-only">Start date</span><input class="input" type="date" bind:value={start} max={end || today} /></label>
          <label><span class="sr-only">End date</span><input class="input" type="date" bind:value={end} min={start} max={today} /></label>
        </div>
        <button class="btn primary sm" type="submit" disabled={!valid}>Apply range</button>
      </form>
    </div>
  {/if}
</div>

<style>
  .drp {
    position: relative;
  }
  .trigger {
    gap: 7px;
    padding: 0 10px;
  }
  .trigger :global(.chev) {
    color: var(--text-3);
  }
  .pop {
    position: absolute;
    right: 0;
    top: calc(100% + 6px);
    z-index: 30;
    width: 264px;
    max-width: calc(100vw - 32px);
    background: var(--surface);
    border-radius: 10px;
    box-shadow: var(--shadow-pop);
    padding: 6px;
  }
  .presets {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .preset {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 8px;
    height: 32px;
    padding: 0 8px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--text);
    font-size: 13px;
    text-align: left;
  }
  .preset:hover {
    background: var(--neutral-wash);
  }
  .preset[aria-pressed='true'] {
    font-weight: 600;
  }
  .check {
    width: 16px;
    display: inline-flex;
    color: var(--accent-text);
  }
  .custom {
    margin-top: 6px;
    padding: 10px 8px 6px;
    border-top: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .custom-title {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12.5px;
    color: var(--text-2);
    font-weight: 500;
  }
  .dates {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
  }
  .dates .input {
    width: 100%;
    padding: 0 6px;
    font-size: 12.5px;
  }
</style>

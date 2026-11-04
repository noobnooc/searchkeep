<script lang="ts">
  // Caveats about a dataset, folded into one line so the data stays the focus.
  import Icon from './Icon.svelte';

  interface Props {
    notes: string[] | undefined;
    /** Notes already explained elsewhere on the page. */
    hide?: (note: string) => boolean;
  }
  let { notes, hide }: Props = $props();
  const shown = $derived((notes ?? []).filter((n) => !hide?.(n)));
</script>

{#if shown.length}
  <details class="notes">
    <summary><Icon name="info" size={13} /> {shown.length === 1 ? '1 note' : `${shown.length} notes`} about this data</summary>
    <ul aria-label="Notes about this data">
      {#each shown as note (note)}
        <li>{note}</li>
      {/each}
    </ul>
  </details>
{/if}

<style>
  .notes {
    font-size: 12px;
    line-height: 1.5;
    color: var(--text-3);
  }
  summary {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
    list-style: none;
    font-family: var(--mono);
    font-size: 10.5px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    border-radius: 4px;
  }
  summary::-webkit-details-marker {
    display: none;
  }
  summary:hover {
    color: var(--text-2);
  }
  ul {
    margin: 6px 0 0;
    padding: 0 0 0 19px;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
</style>

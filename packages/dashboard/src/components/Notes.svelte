<script lang="ts">
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
  <ul class="notes" aria-label="Notes about this data">
    {#each shown as note (note)}
      <li><Icon name="info" size={13} /> <span>{note}</span></li>
    {/each}
  </ul>
{/if}

<style>
  .notes {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  li {
    display: flex;
    gap: 7px;
    align-items: flex-start;
    font-size: 12px;
    line-height: 1.5;
    color: var(--text-3);
  }
  li :global(.icon) {
    margin-top: 2.5px;
    opacity: 0.8;
  }
</style>

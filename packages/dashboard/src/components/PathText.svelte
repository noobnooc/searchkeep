<script lang="ts">
  // A URL path that wraps at "/" and "-" instead of mid-word on narrow screens.
  interface Props {
    path: string | null | undefined;
  }
  let { path }: Props = $props();
  const parts = $derived((path ?? '').split(/(?<=[/\-_.?&=])/));
</script>

<span class="path">{#each parts as p, i (i)}{p}{#if i < parts.length - 1}<wbr />{/if}{/each}</span>

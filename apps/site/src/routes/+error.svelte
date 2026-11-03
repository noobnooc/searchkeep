<script lang="ts">
  import { page } from '$app/state';
  import NotFound from '#lib/components/NotFound.svelte';
</script>

<svelte:head>
  <title>{page.status} · Searchkeep</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<NotFound status={page.status} message={page.status === 404 ? undefined : page.error?.message} />

<script lang="ts">
  let status = $state<string>('loading');
  fetch('/api/status').then(async (r) => (status = (await r.json()).state ?? 'unknown'));
</script>

<main><h1>Searchkeep</h1><p>Status: {status}</p></main>

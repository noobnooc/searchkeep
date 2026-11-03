<script lang="ts">
  import Seo from '#lib/components/Seo.svelte';
  import NotFound from '#lib/components/NotFound.svelte';
</script>

<!-- Prerendered to /404.html, which Cloudflare serves for unknown paths (not_found_handling: "404-page"). -->
<Seo title="Page not found" description="This page does not exist." path="/404" noindex />
<NotFound />

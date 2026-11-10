<script lang="ts">
  // The site's own icon (apple-touch-icon, icon or favicon.ico), which the Worker reads from the
  // site itself. Shows the domain's first letter until the icon loads, and when the site has none.
  import { apiUrl } from '../lib/api';
  import Avatar from './Avatar.svelte';

  interface Props {
    site: { id: string; domain: string } | undefined;
    size?: 'sm' | 'md' | 'lg';
  }
  let { site, size = 'md' }: Props = $props();

  const src = $derived(site ? apiUrl('/api/site-icon', { site: site.id }) : '');
  const letter = $derived(site?.domain.replace(/^www\./, '').charAt(0).toUpperCase() || '?');
</script>

<Avatar {src} {letter} {size} />

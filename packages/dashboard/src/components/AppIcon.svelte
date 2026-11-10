<script lang="ts">
  // The app's own icon, which the Worker reads from App Store Connect (the newest build's icon) or,
  // failing that, from the app's linked site. Shows the name's first letter until the icon loads,
  // and when there is none (Google Play has no read-only API for the icon).
  import { apiUrl } from '../lib/api';
  import Avatar from './Avatar.svelte';

  interface Props {
    app: { id: string; name: string } | undefined;
    size?: 'sm' | 'md' | 'lg';
  }
  let { app, size = 'md' }: Props = $props();

  const src = $derived(app ? apiUrl('/api/app-icon', { app: app.id }) : '');
  const letter = $derived(app?.name.trim().charAt(0).toUpperCase() || '?');
</script>

<Avatar {src} {letter} {size} kind="app" />

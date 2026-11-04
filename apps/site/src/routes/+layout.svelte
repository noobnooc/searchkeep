<script lang="ts">
  import '@fontsource-variable/inter/opsz.css';
  import '@fontsource-variable/jetbrains-mono/wght.css';
  import '@fontsource-variable/funnel-display/wght.css';
  import funnelLatin from '@fontsource-variable/funnel-display/files/funnel-display-latin-wght-normal.woff2?url';
  import interLatin from '@fontsource-variable/inter/files/inter-latin-opsz-normal.woff2?url';
  import '#lib/styles/global.css';
  import SiteHeader from '#lib/components/SiteHeader.svelte';
  import SiteFooter from '#lib/components/SiteFooter.svelte';
  import type { LayoutProps } from './$types';

  let { children }: LayoutProps = $props();
</script>

<svelte:head>
  <link rel="preload" href={interLatin} as="font" type="font/woff2" crossorigin="anonymous" />
  <link rel="preload" href={funnelLatin} as="font" type="font/woff2" crossorigin="anonymous" />
</svelte:head>

<a class="skip-link" href="#main">Skip to content</a>
<SiteHeader />
<main id="main">
  {@render children()}
</main>
<SiteFooter />

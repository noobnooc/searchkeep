<script lang="ts">
  import '@fontsource-variable/inter/opsz.css';
  import '@fontsource-variable/inter-tight/wght.css';
  // IBM Plex Mono: latin only, woff2 only (the package CSS would also ship every subset as woff).
  import plexMono400 from '@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2?url';
  import plexMono500 from '@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff2?url';
  import interTightLatin from '@fontsource-variable/inter-tight/files/inter-tight-latin-wght-normal.woff2?url';
  import interLatin from '@fontsource-variable/inter/files/inter-latin-opsz-normal.woff2?url';
  import '#lib/styles/global.css';
  import SiteHeader from '#lib/components/SiteHeader.svelte';
  import SiteFooter from '#lib/components/SiteFooter.svelte';
  import type { LayoutProps } from './$types';

  let { children }: LayoutProps = $props();

  const LATIN =
    'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
  const plexFaces = [
    [400, plexMono400],
    [500, plexMono500],
  ]
    .map(
      ([w, src]) =>
        `@font-face{font-family:'IBM Plex Mono';font-style:normal;font-display:swap;font-weight:${w};src:url(${src}) format('woff2');unicode-range:${LATIN}}`,
    )
    .join('');
</script>

<svelte:head>
  {@html `<style>${plexFaces}</style>`}
  <link rel="preload" href={interLatin} as="font" type="font/woff2" crossorigin="anonymous" />
  <link rel="preload" href={interTightLatin} as="font" type="font/woff2" crossorigin="anonymous" />
</svelte:head>

<a class="skip-link" href="#main">Skip to content</a>
<SiteHeader />
<main id="main">
  {@render children()}
</main>
<SiteFooter />

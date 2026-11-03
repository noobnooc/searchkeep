<script lang="ts">
  import { SITE, absolute } from '../site';
  import { graph } from '../schema';

  let {
    title,
    description,
    path,
    type = 'website',
    jsonld = [],
    noindex = false,
  }: {
    title: string;
    description: string;
    path: string;
    type?: 'website' | 'article';
    jsonld?: Record<string, unknown>[];
    noindex?: boolean;
  } = $props();

  const fullTitle = $derived(title === SITE.name ? `${SITE.name} — ${SITE.tagline}` : `${title} · ${SITE.name}`);
  const url = $derived(absolute(path));
  const image = `${SITE.origin}/og.png`;
</script>

<svelte:head>
  <title>{fullTitle}</title>
  <meta name="description" content={description} />
  <link rel="canonical" href={url} />
  {#if noindex}<meta name="robots" content="noindex" />{/if}

  <meta property="og:type" content={type} />
  <meta property="og:site_name" content={SITE.name} />
  <meta property="og:title" content={fullTitle} />
  <meta property="og:description" content={description} />
  <meta property="og:url" content={url} />
  <meta property="og:image" content={image} />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:image:alt" content="Searchkeep — SEO & GEO analytics that lives in your Cloudflare account." />
  <meta property="og:locale" content="en_US" />

  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content={fullTitle} />
  <meta name="twitter:description" content={description} />
  <meta name="twitter:image" content={image} />

  {#if jsonld.length}
    {@html `<script type="application/ld+json">${graph(jsonld)}</` + 'script>'}
  {/if}
</svelte:head>

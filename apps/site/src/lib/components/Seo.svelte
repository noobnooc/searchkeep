<script lang="ts">
  import { SITE, absolute } from '../site';
  import { graph, organization, website, webPage } from '../schema';
  import { ogImagePath } from '../og';

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
  // Every indexable page has its own OG card (static/og/, rendered by scripts/render-assets.mjs).
  const image = $derived(`${SITE.origin}${ogImagePath(path)}`);
  const imageAlt = $derived(title === SITE.name ? `${SITE.name}: ${SITE.tagline}` : `${title} · ${SITE.name}`);
  // Every indexable page carries its own WebPage node, linked to the WebSite and Organization
  // nodes (added here when the page did not include them, so the @id references resolve).
  const nodes = $derived.by(() => {
    if (noindex) return jsonld;
    const ids = new Set(jsonld.map((n) => n['@id']));
    return [
      ...(ids.has(organization['@id']) ? [] : [organization]),
      ...(ids.has(website['@id']) ? [] : [website]),
      webPage({ path, title: fullTitle, description, image, type }),
      ...jsonld,
    ];
  });
</script>

<svelte:head>
  <title>{fullTitle}</title>
  <meta name="description" content={description} />
  {#if noindex}
    <!-- A noindex page has no canonical: the two signals would contradict each other. -->
    <meta name="robots" content="noindex, follow" />
  {:else}
    <link rel="canonical" href={url} />
    <!-- Allow large image previews and full snippets in search results and Discover. -->
    <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" />
  {/if}

  <meta property="og:type" content={type} />
  <meta property="og:site_name" content={SITE.name} />
  <meta property="og:title" content={fullTitle} />
  <meta property="og:description" content={description} />
  <meta property="og:url" content={url} />
  <meta property="og:image" content={image} />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:image:alt" content={imageAlt} />
  <meta property="og:image:type" content="image/png" />
  <meta property="og:locale" content="en_US" />

  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content={fullTitle} />
  <meta name="twitter:description" content={description} />
  <meta name="twitter:image" content={image} />
  <meta name="twitter:image:alt" content={imageAlt} />

  {#if nodes.length}
    {@html `<script type="application/ld+json">${graph(nodes)}</` + 'script>'}
  {/if}
</svelte:head>

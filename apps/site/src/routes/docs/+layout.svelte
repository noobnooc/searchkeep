<script lang="ts">
  import { page } from '$app/state';
  import Seo from '#lib/components/Seo.svelte';
  import Icon from '#lib/components/Icon.svelte';
  import { DOCS, findDoc, neighbours } from '#lib/docs.ts';
  import { FAQS } from '#lib/content.ts';
  import { breadcrumbs, faqPage } from '#lib/schema.ts';
  import { GITHUB } from '#lib/site.ts';
  import type { LayoutProps } from './$types';

  let { children }: LayoutProps = $props();

  const path = $derived(page.url.pathname.length > 1 ? page.url.pathname.replace(/\/$/, '') : page.url.pathname);
  const doc = $derived(findDoc(path));
  const nb = $derived(neighbours(path));
  const section = $derived(DOCS.find((s) => s.pages.some((p) => p.path === path)));
  const crumbs = $derived(
    doc && doc.path !== '/docs'
      ? [
          { name: 'Home', path: '/' },
          { name: 'Docs', path: '/docs' },
          { name: doc.title, path: doc.path },
        ]
      : [
          { name: 'Home', path: '/' },
          { name: 'Docs', path: '/docs' },
        ]
  );
  const jsonld = $derived(path === '/docs/faq' ? [breadcrumbs(crumbs), faqPage(FAQS, path)] : [breadcrumbs(crumbs)]);
  const source = $derived(
    `${GITHUB.repo}/blob/main/apps/site/src/routes${path}/+page.svelte`
  );
</script>

{#if doc}
  <Seo title={doc.path === '/docs' ? 'Docs' : doc.title} description={doc.description} {path} type="article" {jsonld} />
{/if}

<div class="docs container">
  <aside class="sidebar" aria-label="Documentation">
    <details class="mobile-nav" data-menu>
      <summary>
        <span>{section?.title ?? 'Docs'} <span class="sep">/</span> <b>{doc?.nav ?? doc?.title}</b></span>
        <Icon name="menu" size={16} />
      </summary>
      {@render navList()}
    </details>
    <div class="desktop-nav">{@render navList()}</div>
  </aside>

  <article class="content">
    <nav class="crumbs" aria-label="Breadcrumb">
      <ol>
        {#each crumbs as c, i (c.path)}
          <li>
            {#if i < crumbs.length - 1}<a href={c.path}>{c.name}</a>{:else}<span aria-current="page">{c.name}</span>{/if}
          </li>
        {/each}
      </ol>
    </nav>
    {#if doc}
      <header class="doc-head">
        <h1>{doc.title}</h1>
        <p class="lead">{doc.description}</p>
      </header>
    {/if}
    <div class="prose">
      {@render children()}
    </div>

    <footer class="doc-foot">
      <div class="pager">
        {#if nb.prev}
          <a class="pg prev" href={nb.prev.path}>
            <span class="pg-k">Previous</span>
            <span class="pg-t">{nb.prev.nav ?? nb.prev.title}</span>
          </a>
        {:else}<span></span>{/if}
        {#if nb.next}
          <a class="pg next" href={nb.next.path}>
            <span class="pg-k">Next</span>
            <span class="pg-t">{nb.next.nav ?? nb.next.title}</span>
          </a>
        {/if}
      </div>
      <div class="edit">
        <a href={source}>Edit this page on GitHub <Icon name="external" size={13} /></a>
        <a href={GITHUB.issues}>Report an issue <Icon name="external" size={13} /></a>
      </div>
    </footer>
  </article>

  {#if doc && doc.toc.length > 1}
    <aside class="toc" aria-label="On this page" data-toc>
      <div class="toc-inner">
        <div class="toc-title">On this page</div>
        <ul>
          {#each doc.toc as t (t.id)}
            <li class:sub={t.level === 3}><a href="#{t.id}">{t.title}</a></li>
          {/each}
        </ul>
      </div>
    </aside>
  {/if}
</div>

{#snippet navList()}
  <nav class="nav">
    {#each DOCS as s (s.title)}
      <div class="group">
        <div class="group-title">{s.title}</div>
        <ul>
          {#each s.pages as p (p.path)}
            <li>
              <a href={p.path} aria-current={p.path === path ? 'page' : undefined}>{p.nav ?? p.title}</a>
            </li>
          {/each}
        </ul>
      </div>
    {/each}
    <div class="group">
      <div class="group-title">More</div>
      <ul>
        <li><a href="/changelog" aria-current={path === '/changelog' ? 'page' : undefined}>Changelog</a></li>
        <li><a href={GITHUB.repo}>GitHub <Icon name="external" size={12} /></a></li>
      </ul>
    </div>
  </nav>
{/snippet}

<style>
  .docs {
    display: grid;
    grid-template-columns: 220px minmax(0, 1fr) 200px;
    gap: 56px;
    align-items: start;
    padding-top: 40px;
    padding-bottom: 96px;
  }
  .sidebar {
    position: sticky;
    top: calc(var(--header-h) + 32px);
    max-height: calc(100dvh - var(--header-h) - 48px);
    overflow-y: auto;
    padding-bottom: 24px;
    scrollbar-width: thin;
  }
  .mobile-nav {
    display: none;
  }
  .group + .group {
    margin-top: 26px;
  }
  .group-title {
    margin-bottom: 8px;
    padding-left: 10px;
    font-family: var(--font-mono);
    font-size: 0.6875rem;
    font-weight: 500;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-3);
  }
  .nav ul {
    list-style: none;
    padding: 0;
    display: grid;
    gap: 1px;
  }
  .nav a {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    border-radius: 7px;
    font-size: var(--fs-sm);
    color: var(--text-3);
    transition: color 150ms, background-color 150ms;
  }
  .nav a:hover {
    color: var(--text);
    background: var(--surface-2);
  }
  .nav a[aria-current='page'] {
    color: var(--text);
    font-weight: 550;
    background: var(--surface-2);
  }
  /* "You are here": the Signal dot that ends the mark's line. */
  .nav a[aria-current='page']::after {
    content: '';
    flex: none;
    width: 5px;
    height: 5px;
    margin-left: auto;
    border-radius: 50%;
    background: var(--signal);
  }

  .content {
    min-width: 0;
    max-width: 760px;
  }
  .crumbs ol {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    list-style: none;
    padding: 0;
    font-size: var(--fs-sm);
    color: var(--text-4);
  }
  .crumbs li + li::before {
    content: '/';
    margin-right: 6px;
    color: var(--text-4);
  }
  .crumbs a {
    color: var(--text-3);
  }
  .crumbs a:hover {
    color: var(--text);
  }
  .crumbs [aria-current] {
    color: var(--text-2);
  }
  .doc-head {
    margin-top: 18px;
    padding-bottom: 28px;
    border-bottom: 1px solid var(--line);
    margin-bottom: 32px;
  }
  .doc-head h1 {
    font-size: clamp(2rem, 1.5rem + 2vw, 2.75rem);
    letter-spacing: -0.024em;
    line-height: 1.08;
  }
  .doc-head .lead {
    margin-top: 14px;
  }
  .prose :global(> :first-child) {
    margin-top: 0;
  }

  .doc-foot {
    margin-top: 64px;
    padding-top: 28px;
    border-top: 1px solid var(--line);
  }
  .pager {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
  }
  .pg {
    display: grid;
    gap: 2px;
    padding: 14px 16px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--bg-elev);
    transition: border-color 150ms, box-shadow 200ms;
  }
  .pg:hover {
    border-color: var(--accent-line);
    box-shadow: 0 0 0 4px var(--accent-soft);
  }
  .pg.next {
    text-align: right;
    grid-column: 2;
  }
  .pg-k {
    font-size: var(--fs-xs);
    color: var(--text-4);
  }
  .pg-t {
    font-weight: 550;
    color: var(--text);
  }
  .edit {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 24px;
    margin-top: 24px;
    font-size: var(--fs-sm);
  }
  .edit a {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--text-3);
  }
  .edit a:hover {
    color: var(--text);
  }

  .toc {
    position: sticky;
    top: calc(var(--header-h) + 32px);
    max-height: calc(100dvh - var(--header-h) - 48px);
    overflow-y: auto;
    scrollbar-width: thin;
  }
  .toc-title {
    font-family: var(--font-mono);
    font-size: 0.6875rem;
    font-weight: 500;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-3);
    margin-bottom: 10px;
  }
  .toc ul {
    list-style: none;
    padding: 0;
    border-left: 1px solid var(--line);
  }
  .toc a {
    display: block;
    margin-left: -1px;
    padding: 4px 0 4px 12px;
    border-left: 1px solid transparent;
    font-size: 0.8125rem;
    line-height: 1.45;
    color: var(--text-3);
    transition: color 150ms, border-color 150ms;
  }
  .toc .sub a {
    padding-left: 24px;
  }
  .toc a:hover {
    color: var(--text);
  }
  .toc a:global([aria-current]) {
    color: var(--text);
    border-left-color: var(--accent);
  }

  @media (max-width: 1180px) {
    .docs {
      grid-template-columns: 210px minmax(0, 1fr);
      gap: 48px;
    }
    .toc {
      display: none;
    }
  }
  @media (max-width: 860px) {
    .docs {
      grid-template-columns: minmax(0, 1fr);
      gap: 0;
      padding-top: 0;
    }
    .sidebar {
      position: sticky;
      top: var(--header-h);
      z-index: 20;
      max-height: none;
      overflow: visible;
      margin-inline: calc(var(--gutter) * -1);
      padding: 0;
      background: var(--overlay);
      -webkit-backdrop-filter: blur(14px);
      backdrop-filter: blur(14px);
      border-bottom: 1px solid var(--line);
    }
    .desktop-nav {
      display: none;
    }
    .mobile-nav {
      display: block;
    }
    .mobile-nav summary {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 12px var(--gutter);
      list-style: none;
      cursor: pointer;
      font-size: var(--fs-sm);
      color: var(--text-3);
    }
    .mobile-nav summary::-webkit-details-marker {
      display: none;
    }
    .mobile-nav summary b {
      color: var(--text);
      font-weight: 550;
    }
    .mobile-nav .sep {
      margin-inline: 4px;
      color: var(--text-4);
    }
    .mobile-nav .nav {
      position: absolute;
      left: 0;
      right: 0;
      top: 100%;
      max-height: 70dvh;
      overflow-y: auto;
      padding: 8px var(--gutter) 20px;
      border-top: 1px solid var(--line);
      border-bottom: 1px solid var(--line);
      background: var(--bg);
      box-shadow: var(--shadow-lg);
    }
    .content {
      padding-top: 24px;
    }
  }
  @media (max-width: 520px) {
    .pager {
      grid-template-columns: 1fr;
    }
    .pg.next {
      grid-column: 1;
    }
  }
</style>

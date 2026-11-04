<script lang="ts">
  import Icon from './Icon.svelte';

  let { status = 404, message }: { status?: number; message?: string } = $props();

  const links = [
    { href: '/docs', label: 'Documentation', text: 'Introduction and guides' },
    { href: '/docs/deploy', label: 'Deploy', text: 'Run Searchkeep in your Cloudflare account' },
    { href: '/docs/mcp', label: 'MCP tools', text: 'Connect your AI client' },
    { href: '/changelog', label: 'Changelog', text: 'What’s new' },
  ];
</script>

<section class="nf container">
  <div class="code" aria-hidden="true">{status}</div>
  <h1>{status === 404 ? 'This page wasn’t kept.' : 'Something went wrong.'}</h1>
  <p class="lead">
    {message ?? 'The page you’re looking for doesn’t exist or has moved. Unlike your search data, we let this one go.'}
  </p>
  <div class="actions">
    <a class="btn btn-primary btn-lg" href="/">Back to home <Icon name="arrow" /></a>
  </div>
  <ul class="links">
    {#each links as l (l.href)}
      <li>
        <a href={l.href}><span class="t">{l.label}</span><span class="d">{l.text}</span></a>
      </li>
    {/each}
  </ul>
</section>

<style>
  .nf {
    padding-block: clamp(4rem, 3rem + 6vw, 8rem);
    text-align: center;
    max-width: calc(760px + var(--gutter) * 2);
  }
  .code {
    font-size: clamp(5rem, 3rem + 10vw, 9rem);
    font-weight: 700;
    letter-spacing: -0.048em;
    line-height: 1;
    color: var(--text);
  }
  h1 {
    margin-top: 12px;
    font-size: var(--fs-2xl);
  }
  .lead {
    margin: 14px auto 0;
    max-width: 520px;
  }
  .actions {
    margin-top: 32px;
  }
  .links {
    list-style: none;
    padding: 0;
    margin-top: 56px;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
    text-align: left;
  }
  .links a {
    display: grid;
    gap: 2px;
    padding: 14px 16px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--bg-elev);
    transition: border-color 150ms, box-shadow 200ms;
  }
  .links a:hover {
    border-color: var(--accent-line);
    box-shadow: 0 0 0 4px var(--accent-soft);
  }
  .t {
    font-weight: 600;
    color: var(--text);
  }
  .d {
    font-size: var(--fs-sm);
    color: var(--text-3);
  }
  @media (max-width: 520px) {
    .links {
      grid-template-columns: 1fr;
    }
  }
</style>

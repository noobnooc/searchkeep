<script lang="ts">
  import Seo from '#lib/components/Seo.svelte';
  import { GITHUB, SITE } from '#lib/site.ts';
  import { breadcrumbs } from '#lib/schema.ts';
</script>

<Seo
  title="Privacy"
  description="searchkeep.dev sets no cookies and runs no trackers. The Searchkeep software sends no telemetry; your data stays in your Cloudflare account."
  path="/privacy"
  jsonld={[breadcrumbs([{ name: 'Home', path: '/' }, { name: 'Privacy', path: '/privacy' }])]}
/>

<div class="container page">
  <header class="page-head">
    <span class="eyebrow">Privacy</span>
    <h1>Privacy</h1>
    <p class="lead">Short version: we don’t collect anything, on this website or in the product.</p>
    <p class="updated">Last updated <time datetime={SITE.lastUpdated}>November 3, 2026</time></p>
  </header>

  <div class="prose">
    <h2 id="website">This website</h2>
    <ul>
      <li><strong>No cookies.</strong> searchkeep.dev does not set any cookies.</li>
      <li><strong>No trackers or analytics scripts.</strong> There is no third-party JavaScript, no tracking pixel and no fingerprinting.</li>
      <li><strong>No third-party requests.</strong> Fonts and every other asset are served from searchkeep.dev itself.</li>
      <li>
        <strong>Local preference only.</strong> If you use the theme toggle, your choice is stored in your browser’s
        <code>localStorage</code>. It never leaves your device.
      </li>
      <li>
        <strong>Hosting.</strong> The site is static files served by Cloudflare. Like any web host, Cloudflare processes
        technical request data (such as IP addresses) to deliver and protect the site, under
        <a href="https://www.cloudflare.com/privacypolicy/">Cloudflare’s privacy policy</a>. We do not receive or keep
        logs of individual visits.
      </li>
    </ul>

    <h2 id="software">The Searchkeep software</h2>
    <ul>
      <li><strong>No telemetry.</strong> Searchkeep does not report usage, errors or anything else to the project or to anyone else.</li>
      <li>
        <strong>Your data stays in your account.</strong> Searchkeep runs as a Worker and a D1 database in your own Cloudflare
        account. Data flows only between the APIs you configure (Google Search Console, Bing Webmaster Tools, Cloudflare)
        and your D1 database, and is served only to people your Cloudflare Access policy allows.
      </li>
      <li>
        <strong>No vendor server.</strong> There is no Searchkeep backend. The project cannot see your data, your
        configuration or even whether you deployed it.
      </li>
      <li>
        <strong>AI clients you connect.</strong> When you use an MCP client such as Claude, Cursor or ChatGPT, the tool
        results you request are sent to that client and handled under its own terms. That is your choice and is
        controlled by you.
      </li>
    </ul>

    <h2 id="contact">Contact</h2>
    <p>Questions about privacy? Open an <a href={GITHUB.issues}>issue on GitHub</a>.</p>
  </div>
</div>

<style>
  .page {
    padding-top: clamp(3rem, 2rem + 4vw, 5.5rem);
    padding-bottom: 96px;
    max-width: calc(760px + var(--gutter) * 2);
  }
  .page-head {
    padding-bottom: 32px;
    border-bottom: 1px solid var(--line);
    margin-bottom: 8px;
  }
  .page-head h1 {
    margin-top: 14px;
    font-size: var(--fs-3xl);
    letter-spacing: -0.028em;
  }
  .page-head .lead {
    margin-top: 14px;
  }
  .updated {
    margin-top: 10px;
    font-size: var(--fs-sm);
    color: var(--text-4);
  }
</style>

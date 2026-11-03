<script lang="ts">
  import Callout from '#lib/components/Callout.svelte';
  import CodeBlock from '#lib/components/CodeBlock.svelte';
  import { SITES_EXAMPLE } from '#lib/content.ts';
  import { GITHUB } from '#lib/site.ts';

  const secretsRequired = `# Run anywhere with Node.js; wrangler asks you to log in the first time.
npx wrangler secret put ACCESS_TEAM_DOMAIN --name searchkeep
npx wrangler secret put ACCESS_AUD --name searchkeep
npx wrangler secret put CLOUDFLARE_ACCOUNT_ID --name searchkeep
npx wrangler secret put CLOUDFLARE_API_TOKEN --name searchkeep`;

  const gcloud = `gcloud services enable searchconsole.googleapis.com --project my-project
gcloud iam service-accounts create searchkeep --project my-project \\
  --display-name "Searchkeep (read-only)"
gcloud iam service-accounts keys create searchkeep-key.json \\
  --iam-account searchkeep@my-project.iam.gserviceaccount.com`;

  const gscSecrets = `# Read both fields straight from the key file, so nothing is pasted by hand.
jq -r .client_email searchkeep-key.json | npx wrangler secret put GSC_CLIENT_EMAIL --name searchkeep
jq -r .private_key searchkeep-key.json | npx wrangler secret put GSC_PRIVATE_KEY --name searchkeep

# Then delete the local key file.
rm searchkeep-key.json`;

  const bingSecret = `npx wrangler secret put BING_API_KEY --name searchkeep`;

  const sitesSecret = `npx wrangler secret put SITES --name searchkeep < sites.json`;
</script>

<h2 id="overview">Overview</h2>
<p>
  You deploy Searchkeep by forking the repository and letting <strong>Cloudflare Workers Builds</strong> build and
  deploy your fork. There is no “Deploy to Cloudflare” button on purpose: a fork you own is what lets you upgrade later
  with one click, and it keeps every piece of configuration out of the repository and in Worker Secrets.
</p>
<p>The whole flow takes about twenty minutes. Each step below says who does it and how to check it worked.</p>
<div class="table-wrap">
  <table>
    <thead><tr><th>Step</th><th>Who</th><th>Result</th></tr></thead>
    <tbody>
      <tr><td><a href="#fork">1. Fork</a></td><td>You or an agent</td><td>Your own copy of the repo</td></tr>
      <tr><td><a href="#github-app">2. GitHub App</a></td><td><span class="who human">Human, once</span></td><td>Cloudflare can read your fork</td></tr>
      <tr><td><a href="#workers-builds">3. Workers Builds</a></td><td>You or an agent</td><td>A Worker named <code>searchkeep</code></td></tr>
      <tr><td><a href="#database">4. First build</a></td><td>Automatic</td><td>A D1 database named <code>searchkeep</code></td></tr>
      <tr><td><a href="#domain">5. Custom domain</a></td><td>You or an agent</td><td><code>searchkeep.example.com</code>, workers.dev off</td></tr>
      <tr><td><a href="#access">6. Access</a></td><td><span class="who human">Human, first time</span> then agent</td><td>Login, Managed OAuth, tight policy</td></tr>
      <tr><td><a href="#credentials">7. Credentials</a></td><td>Partly human</td><td>Secrets for each data source</td></tr>
      <tr><td><a href="#verify">8. Verify</a></td><td>You or an agent</td><td><code>setup_status</code> reports <code>ready</code></td></tr>
    </tbody>
  </table>
</div>

<h2 id="before-you-start">Before you start</h2>
<ul>
  <li>A GitHub account and a Cloudflare account.</li>
  <li>
    A hostname on a Cloudflare zone for the Worker, for example <code>searchkeep.example.com</code>. It does not have to
    be on the same zone as the sites you analyze.
  </li>
  <li>Admin access to the Search Console properties, Bing Webmaster Tools sites and Cloudflare zones you want to connect.</li>
  <li>
    Node.js 20 or newer if you want to set secrets from a terminal with <code>npx wrangler</code>. You can also set
    every secret in the Cloudflare dashboard instead.
  </li>
</ul>

<h2 id="fork">1. Fork the repository</h2>
<p>
  Fork <a href={GITHUB.repo}>noobnooc/searchkeep</a> to your account or organization. Keep the default branch
  (<code>main</code>). A public fork is fine: there is nothing secret in the repository, and nothing you configure ever
  gets committed.
</p>
<Callout kind="agent">
  <p>An agent with the GitHub MCP server can do this with its fork tool. Running it again on an existing fork is a no-op.</p>
</Callout>
<p><strong>Verify:</strong> <code>https://github.com/&lt;you&gt;/searchkeep</code> exists and shows “forked from noobnooc/searchkeep”.</p>

<h2 id="github-app">2. Authorize the Cloudflare GitHub App</h2>
<Callout kind="human" title="Human step, once per GitHub account">
  <p>
    In the Cloudflare dashboard, go to <strong>Workers &amp; Pages → Create → Import a repository</strong> and connect
    GitHub. GitHub asks you to install the Cloudflare Workers and Pages app; grant it access to your
    <code>searchkeep</code> fork (selecting only that repository is enough). This is an OAuth consent screen, so an agent
    cannot click it for you.
  </p>
</Callout>
<p><strong>Verify:</strong> your fork appears in the repository picker in Cloudflare.</p>

<h2 id="workers-builds">3. Create the Worker with Workers Builds</h2>
<p>Pick your fork in the repository picker and use these settings:</p>
<div class="table-wrap">
  <table>
    <thead><tr><th>Setting</th><th>Value</th></tr></thead>
    <tbody>
      <tr><td>Project name</td><td><code>searchkeep</code></td></tr>
      <tr><td>Production branch</td><td><code>main</code></td></tr>
      <tr><td>Root directory</td><td><code>apps/cloudflare</code></td></tr>
      <tr><td>Build command</td><td><code>pnpm run build</code></td></tr>
      <tr><td>Deploy command</td><td><code>pnpm run deploy</code></td></tr>
      <tr><td>Build watch paths</td><td><code>apps/cloudflare/**</code>, <code>packages/**</code></td></tr>
    </tbody>
  </table>
</div>
<p>
  The build command compiles the dashboard into the Worker’s static assets. The deploy command applies D1 migrations
  and then deploys (<code>wrangler d1 migrations apply DB --remote &amp;&amp; wrangler deploy</code>), so every
  deployment, including upgrades, migrates first. The watch paths make sure changes to the website in
  <code>apps/site</code> do not trigger a rebuild of your Worker.
</p>
<Callout kind="agent">
  <p>
    An agent can create the same configuration through the Workers Builds API (repository connection, build token and
    trigger) using the Cloudflare MCP server, once step 2 is done.
  </p>
</Callout>

<h2 id="database">4. The first build creates D1</h2>
<p>
  The repository’s <code>wrangler.jsonc</code> declares a D1 binding called <code>DB</code> with
  <code>database_name: "searchkeep"</code> but deliberately <em>no</em> <code>database_id</code>. On the first deploy,
  Wrangler provisions the database automatically. Its ID lives only in your Cloudflare account and is never written
  back to the repository, so syncing upstream never conflicts with your setup.
</p>
<p>
  <strong>Verify:</strong> the first build succeeds, and <strong>Storage &amp; Databases → D1</strong> lists a database
  named <code>searchkeep</code> with the migrations applied.
</p>
<Callout kind="note" title="The Worker is locked at this point">
  <p>
    Until Access is configured in step 6, the Worker is in the <code>no_access</code> state: it serves only a public
    setup guide at <code>/setup</code>, refuses <code>/api</code> and <code>/mcp</code>, and the cron does not sync. That
    is expected.
  </p>
</Callout>

<h2 id="domain">5. Add a custom domain</h2>
<p>
  In the Worker’s <strong>Settings → Domains &amp; Routes</strong>, add a <strong>Custom domain</strong> such as
  <code>searchkeep.example.com</code>. Then, in the same panel, <strong>disable the workers.dev route and Preview
  URLs</strong>.
</p>
<ul>
  <li>
    A custom domain is required, not cosmetic: Cloudflare Access applications attach to hostnames on your zones, and the
    Workers Cache API, which Searchkeep uses for token and response caching, does not work on workers.dev.
  </li>
  <li>
    Disabling workers.dev and previews removes every hostname that Access does not cover. The Worker would still reject
    requests without a valid Access JWT there, but there is no reason to leave the door visible.
  </li>
</ul>
<p><strong>Verify:</strong> opening <code>https://searchkeep.example.com/setup</code> shows the public setup guide.</p>

<h2 id="access">6. Protect it with Cloudflare Access</h2>
<Callout kind="human" title="Human step, first time only">
  <p>
    If your account has never used Zero Trust, open <strong>Zero Trust</strong> in the Cloudflare dashboard and create
    your organization: choose a team name (this becomes <code>&lt;team&gt;.cloudflareaccess.com</code>) and a plan. The
    free plan works. Everything after this can be done by an agent with the Cloudflare MCP server.
  </p>
</Callout>
<ol>
  <li>
    In <strong>Zero Trust → Access → Applications</strong>, add a <strong>Self-hosted</strong> application for
    <code>searchkeep.example.com</code>, covering the whole hostname.
  </li>
  <li>
    Add one <strong>Allow</strong> policy that includes only your own email address, or a short list of specific emails.
    Do not allow “Everyone”, and do not allow a public email domain like <code>gmail.com</code>; Searchkeep detects both
    and stays locked (<code>policy_too_broad</code>).
  </li>
  <li>
    In the application’s settings, turn on <strong>Managed OAuth</strong>. This makes Access a full OAuth 2.1
    authorization server for MCP clients, with dynamic client registration and PKCE. Without it, Searchkeep stays in
    <code>oauth_disabled</code>.
  </li>
  <li>
    Copy the application’s <strong>Application Audience (AUD) Tag</strong> from its overview, and your team domain from
    <strong>Zero Trust → Settings</strong>.
  </li>
</ol>
<p>Store both, together with your account ID and a Cloudflare API token (created in the next step), as Worker Secrets:</p>
<CodeBlock lang="bash" code={secretsRequired} />
<p>
  Values are prompted for interactively and never echoed. For <code>ACCESS_TEAM_DOMAIN</code> enter just the hostname,
  for example <code>myteam.cloudflareaccess.com</code>.
</p>
<p>
  <strong>Verify:</strong> opening <code>https://searchkeep.example.com</code> now redirects to the Access login page,
  and after signing in the dashboard shows the readiness checks.
</p>

<h2 id="credentials">7. Add credentials</h2>
<p>Each data source is optional and independent. Connect what you have; you can add the rest later.</p>

<h3 id="cred-cloudflare">Cloudflare API token</h3>
<p>
  In <strong>My Profile → API Tokens → Create Token → Custom token</strong>, grant these read-only permissions, scoped
  to the account and the zones of the sites you analyze:
</p>
<div class="table-wrap">
  <table>
    <thead><tr><th>Scope</th><th>Permission</th><th>Used for</th></tr></thead>
    <tbody>
      <tr><td>Account</td><td>Account Analytics · Read</td><td>Web Analytics: page views, referrers, Web Vitals</td></tr>
      <tr><td>Zone</td><td>Analytics · Read</td><td>AI crawler requests on proxied zones</td></tr>
      <tr><td>Account</td><td>Access: Apps and Policies · Read</td><td>Checking that Access is configured safely</td></tr>
    </tbody>
  </table>
</div>
<p>Save it as <code>CLOUDFLARE_API_TOKEN</code> (included in the command block above).</p>

<h3 id="cred-gsc">Google Search Console</h3>
<p>Searchkeep reads Search Console with a Google Cloud service account.</p>
<Callout kind="human" title="Human step (or an agent with gcloud)">
  <p>
    In the Google Cloud console, pick or create a project, enable the <strong>Google Search Console API</strong>, create a
    service account and download a JSON key. An agent with an authenticated <code>gcloud</code> can do the same:
  </p>
</Callout>
<CodeBlock lang="bash" code={gcloud} />
<Callout kind="human" title="Human step: add the service account in Search Console">
  <p>
    In Search Console, open each property’s <strong>Settings → Users and permissions → Add user</strong>, enter the
    service account’s email and choose <strong>Restricted</strong>. Restricted is enough for everything except
    submitting sitemaps (see <a href="/docs/configuration#writes">Enabling writes</a>).
  </p>
</Callout>
<CodeBlock lang="bash" code={gscSecrets} />

<h3 id="cred-bing">Bing Webmaster Tools</h3>
<p>
  In Bing Webmaster Tools, open <strong>Settings → API access</strong> and generate an API key. Each user has a single
  key that works for all their sites. The key can also submit URLs and remove sites, so treat it like a password.
</p>
<CodeBlock lang="bash" code={bingSecret} />

<h3 id="cred-sites">Sites</h3>
<p>
  Describe the sites to analyze in a JSON array and store it in the <code>SITES</code> secret. Leave out the fields of
  sources you do not use. The full format is in <a href="/docs/configuration#sites">Configuration</a>.
</p>
<CodeBlock lang="json" title="sites.json" code={SITES_EXAMPLE} />
<CodeBlock lang="bash" code={sitesSecret} />
<p>
  Optionally set <code>BRAND_REGEX</code> for brand vs non-brand splits. Secrets take effect immediately; no redeploy
  is needed.
</p>

<h2 id="verify">8. Verify and run the first sync</h2>
<p>
  Open the dashboard, or connect an MCP client (see <a href="/docs/mcp">MCP server</a>) and ask it to run
  <code>setup_status</code>. You are done when it reports:
</p>
<ul>
  <li>readiness <code>ready</code>;</li>
  <li>every secret you intended to set as present;</li>
  <li>each configured source passing its check for each site.</li>
</ul>
<p>
  The cron runs daily at 03:17 UTC, and only once a <code>ready</code> state has been recorded. Start the first sync
  from the dashboard’s setup view instead of waiting for the night. The first sync begins the Search Console backfill
  of up to 16 months; because a single Worker invocation has limited subrequests and CPU time, the backfill continues
  in batches over the following runs, with its progress shown in <code>setup_status</code>.
</p>

<h2 id="with-an-agent">Deploy with an agent</h2>
<p>
  The repository includes <a href={GITHUB.deployRunbook}>docs/deploy.md</a> and <a href={GITHUB.agents}>AGENTS.md</a>,
  written for AI agents: every step is idempotent, has a verification, and human-only steps are marked so the agent
  stops and asks. With the GitHub and Cloudflare MCP servers connected, a prompt like this is enough:
</p>
<CodeBlock
  lang="text"
  title="Prompt"
  code={`Deploy Searchkeep (github.com/noobnooc/searchkeep) to my Cloudflare account,
following docs/deploy.md in the repository. Use searchkeep.example.com as the
custom domain and allow only me@example.com in the Access policy.
Stop and ask me whenever a step needs a human.`}
/>
<p>The steps that need you are always the same three:</p>
<ol>
  <li>authorizing the Cloudflare GitHub App for the fork;</li>
  <li>creating the Zero Trust organization, the first time;</li>
  <li>adding the service account in Search Console (and creating it, if the agent has no <code>gcloud</code>).</li>
</ol>
<Callout kind="warning" title="Keep secrets out of the chat">
  <p>
    Have the agent run <code>wrangler secret put</code> so values go straight from a file or prompt into Cloudflare. Do
    not paste API keys or private keys into the conversation.
  </p>
</Callout>

<h2 id="troubleshooting">Troubleshooting</h2>
<dl>
  <dt>The dashboard only shows the setup guide</dt>
  <dd>
    You are in <code>no_access</code>: either the request did not come through Access, or <code>ACCESS_TEAM_DOMAIN</code>
    / <code>ACCESS_AUD</code> are missing or wrong. Check that the Access application covers the exact hostname and that
    the AUD tag matches.
  </dd>
  <dt>“Enable Managed OAuth”</dt>
  <dd>The Access application exists but Managed OAuth is off. Turn it on in the application’s settings.</dd>
  <dt>“Tighten your policy”</dt>
  <dd>An Allow policy admits everyone or a public email domain. Replace it with specific emails.</dd>
  <dt>A source check fails</dt>
  <dd>
    For GSC, confirm the service account was added to that exact property and that <code>gscProperty</code> matches it
    (<code>sc-domain:</code> for domain properties). For Bing, confirm <code>bingSiteUrl</code> matches the site as
    registered. For AI crawler data, confirm the zone is proxied and the token has Zone Analytics Read.
  </dd>
  <dt>The build fails at the migration step</dt>
  <dd>
    Open the build log in Workers Builds. If the build token is missing D1 permissions, edit the build token in the
    Worker’s build settings and re-run the build.
  </dd>
</dl>

<style>
  .who {
    display: inline-block;
    padding: 1px 8px;
    border-radius: 6px;
    font-size: var(--fs-xs);
    font-weight: 600;
    white-space: nowrap;
  }
  .who.human {
    color: var(--warn);
    background: var(--warn-soft);
  }
</style>

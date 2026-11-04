<script lang="ts">
  import Callout from '#lib/components/Callout.svelte';
  import CodeBlock from '#lib/components/CodeBlock.svelte';
  import { AGENT_PREREQS, AGENT_PROMPT, READ_ONLY_TOOLS, SITES_EXAMPLE } from '#lib/content.ts';
  import { GITHUB } from '#lib/site.ts';

  const forkCheck = `gh repo fork noobnooc/searchkeep --clone=false
gh repo view <you>/searchkeep --json parent --jq .parent.nameWithOwner
# noobnooc/searchkeep`;

  const lockedCheck = `curl -s https://searchkeep.example.com/healthz
# {"ok":true}

curl -s -w ' %{http_code}\\n' https://searchkeep.example.com/api/status
# {"error":"Searchkeep is locked: …","code":"locked","state":"no_access","setup":"/setup"} 403

curl -s -w ' %{http_code}\\n' -X POST https://searchkeep.example.com/mcp
# {"jsonrpc":"2.0","error":{"code":-32001,"message":"Searchkeep is locked: https://searchkeep.example.com
#  is not protected by Cloudflare Access yet. See https://searchkeep.example.com/setup."},"id":null} 403`;

  const accessCheck = `curl -s -o /dev/null -w '%{http_code}\\n' https://searchkeep.example.com/healthz
# 302 (redirect to <team>.cloudflareaccess.com) or 401, never 200

curl -s -o /dev/null -D - https://searchkeep.example.com/mcp | grep -iE '^(HTTP|www-authenticate)'
# HTTP/2 401 and a www-authenticate header pointing to Access (a 302 means Managed OAuth is off)`;

  const accessSecrets = `# Run anywhere with Node.js 22+; wrangler asks you to log in the first time.
npx wrangler secret put ACCESS_TEAM_DOMAIN --name searchkeep   # e.g. myteam.cloudflareaccess.com
npx wrangler secret put ACCESS_AUD --name searchkeep`;

  const cloudflareSecrets = `npx wrangler secret put CLOUDFLARE_ACCOUNT_ID --name searchkeep
npx wrangler secret put CLOUDFLARE_API_TOKEN --name searchkeep

# Verify the token (paste it when prompted; it is not echoed):
read -rs CF_TOKEN && curl -s https://api.cloudflare.com/client/v4/user/tokens/verify \\
  -H "Authorization: Bearer $CF_TOKEN" | jq -r '.result.status'; unset CF_TOKEN
# active`;

  const gcloud = `gcloud services enable searchconsole.googleapis.com --project my-project
gcloud iam service-accounts create searchkeep --project my-project \\
  --display-name "Searchkeep"
gcloud iam service-accounts keys create searchkeep-key.json \\
  --iam-account searchkeep@my-project.iam.gserviceaccount.com`;

  const gscSecrets = `# Read both fields straight from the key file, so nothing is pasted by hand.
jq -r .client_email searchkeep-key.json | npx wrangler secret put GSC_CLIENT_EMAIL --name searchkeep
jq -r .private_key searchkeep-key.json | npx wrangler secret put GSC_PRIVATE_KEY --name searchkeep

# Then delete the local key file.
rm searchkeep-key.json`;

  const bingSecret = `npx wrangler secret put BING_API_KEY --name searchkeep

# Verify the key (paste it when prompted; it is not echoed):
read -rs BING_KEY && curl -s "https://ssl.bing.com/webmaster/api.svc/json/GetUserSites?apikey=$BING_KEY" \\
  | jq '.d[].Url'; unset BING_KEY`;

  const sitesSecret = `jq -e 'type=="array" and length>0 and all(.[]; .domain)' sites.json   # prints true
npx wrangler secret put SITES --name searchkeep < sites.json`;

  const firstSync = `# From a machine with cloudflared; it opens a browser to sign in through Access.
cloudflared access curl https://searchkeep.example.com/api/sync -X POST`;
</script>

<h2 id="overview">Overview</h2>
<Callout kind="agent" title="Using an AI agent?">
  <p>
    Copy the prompt in <a href="#with-an-agent">Deploy with an agent</a>. Your agent needs access to GitHub and to
    Cloudflare.
  </p>
</Callout>
<p>
  You deploy Searchkeep by forking the repository and letting <strong>Cloudflare Workers Builds</strong> build and
  deploy your fork. There is no “Deploy to Cloudflare” button on purpose: a fork you own is what lets you upgrade later
  with one click, and it keeps every piece of configuration out of the repository and in Worker Secrets.
</p>
<p>
  This page is the condensed version of the runbook in the repository, <a href={GITHUB.deployRunbook}>docs/deploy.md</a>,
  which has every click path, CLI and API alternative and troubleshooting entry. The facts and checks are the same. The
  whole flow takes about 30–45 minutes the first time. Each step says who does it and how to check it worked.
</p>
<div class="table-wrap">
  <table>
    <thead><tr><th>Step</th><th>Who</th><th>Result</th><th>Runbook</th></tr></thead>
    <tbody>
      <tr><td><a href="#fork">1. Fork</a></td><td>You or an agent</td><td>Your own copy of the repo</td><td>1</td></tr>
      <tr><td><a href="#github-app">2. GitHub App</a></td><td><span class="who human">Human, once</span></td><td>Cloudflare can read your fork</td><td>2</td></tr>
      <tr><td><a href="#workers-builds">3. Workers Builds</a></td><td>You or an agent</td><td>A Worker named <code>searchkeep</code></td><td>3</td></tr>
      <tr><td><a href="#database">4. First build</a></td><td>Automatic</td><td>A D1 database named <code>searchkeep</code></td><td>3</td></tr>
      <tr><td><a href="#domain">5. Custom domain</a></td><td>You or an agent</td><td><code>searchkeep.example.com</code>, workers.dev off</td><td>4–5</td></tr>
      <tr><td><a href="#access">6. Access</a></td><td><span class="who human">Human, first time</span> then agent</td><td>Login, Managed OAuth, tight policy</td><td>6–9</td></tr>
      <tr><td><a href="#credentials">7. Credentials</a></td><td>Partly human</td><td>Secrets for each data source</td><td>10–14</td></tr>
      <tr><td><a href="#verify">8. Verify and sync</a></td><td>You or an agent</td><td><code>setup_status</code> reports <code>ready</code></td><td>15–17</td></tr>
    </tbody>
  </table>
</div>

<h2 id="before-you-start">Before you start</h2>
<ul>
  <li>A GitHub account and a Cloudflare account (the Free plan is enough).</li>
  <li>
    A hostname on a zone that is active in that Cloudflare account, for example <code>searchkeep.example.com</code>. It
    must not have a DNS record yet, and it does not have to be on the same zone as the sites you analyze.
  </li>
  <li>
    <strong>Owner</strong> access to the Search Console properties (only owners can add users), the Bing Webmaster Tools
    sites, and the Cloudflare zones you want to connect. Sites you want AI crawler data for must be proxied through
    Cloudflare.
  </li>
  <li>
    Node.js 22 or newer if you want to set secrets from a terminal with <code>npx wrangler</code>. You can also set
    every secret in the Cloudflare dashboard instead.
  </li>
</ul>

<h2 id="fork">1. Fork the repository</h2>
<p>
  Fork <a href={GITHUB.repo}>noobnooc/searchkeep</a> to your account or organization and keep only the default branch
  (<code>main</code>). A public fork is fine: there is nothing secret in the repository, and nothing you configure ever
  gets committed. Do not commit to your fork’s <code>main</code>; keeping it identical to upstream makes “Sync fork”
  conflict-free.
</p>
<Callout kind="agent">
  <p>An agent with the GitHub MCP server can do this with its fork tool. Running it again on an existing fork is a no-op.</p>
</Callout>
<CodeBlock lang="bash" code={forkCheck} />
<p><strong>Verify:</strong> the last command prints <code>noobnooc/searchkeep</code>, or your fork’s page on GitHub shows “forked from noobnooc/searchkeep”.</p>

<h2 id="github-app">2. Authorize the Cloudflare GitHub App</h2>
<Callout kind="human" title="Human step, once per GitHub account">
  <p>
    In the Cloudflare dashboard, go to <strong>Workers &amp; Pages → Create application → Import a repository</strong>
    and connect GitHub. GitHub asks you to install the <strong>Cloudflare Workers and Pages</strong> app; choose
    <strong>Only select repositories</strong> and pick your <code>searchkeep</code> fork. This is a consent screen, so an
    agent cannot click it for you.
  </p>
</Callout>
<p>
  <strong>Verify:</strong> <a href="https://github.com/settings/installations">github.com/settings/installations</a>
  lists Cloudflare Workers and Pages with access to your fork, and the fork appears in Cloudflare’s repository picker.
</p>

<h2 id="workers-builds">3. Create the Worker with Workers Builds</h2>
<p>Pick your fork in the repository picker and use these settings:</p>
<div class="table-wrap">
  <table>
    <thead><tr><th>Setting</th><th>Value</th></tr></thead>
    <tbody>
      <tr><td>Project name</td><td><code>searchkeep</code> (must match the Worker name in <code>wrangler.jsonc</code>)</td></tr>
      <tr><td>Build command</td><td><code>pnpm run build</code></td></tr>
      <tr><td>Deploy command</td><td><code>pnpm run deploy</code></td></tr>
      <tr><td>Root directory</td><td><code>apps/cloudflare</code></td></tr>
      <tr><td>Production branch</td><td><code>main</code>; builds for other branches off</td></tr>
      <tr><td>Build watch paths (include)</td><td><code>apps/cloudflare/*</code>, <code>packages/*</code>, <code>pnpm-lock.yaml</code></td></tr>
    </tbody>
  </table>
</div>
<p>
  The build command compiles the dashboard into the Worker’s static assets. The watch paths make sure a change to the
  Worker, its packages or its dependencies triggers a build, while changes to the website in <code>apps/site</code> or
  to the docs do not.
</p>
<p>
  The deploy command (<code>scripts/deploy.mjs</code>) tries to apply D1 migrations remotely, deploys, then tries the
  migrations once more, and never fails because of them. The default Workers Builds build token has no D1 permission,
  so on Workers Builds the remote migration step is normally skipped with a warning. That is expected and fine: the
  Worker applies any pending migrations itself on its first request, tracking them in the same
  <code>d1_migrations</code> table that Wrangler uses, so a migration is never applied twice. (If you want the build to
  migrate too, add <strong>D1 Edit</strong> to the build token; it is optional.)
</p>
<Callout kind="agent">
  <p>
    An agent can check or fix the build trigger through the Workers Builds API (permission Workers CI Write) using the
    Cloudflare MCP server, once step 2 is done. The runbook lists the exact requests.
  </p>
</Callout>
<p>
  <strong>Verify:</strong> the Worker’s <strong>Deployments</strong> (or <strong>Builds</strong>) tab shows the latest
  build as <strong>Success</strong>, and the build settings show the root directory, both commands and all three
  include paths.
</p>

<h2 id="database">4. The first build creates D1</h2>
<p>
  The repository’s <code>wrangler.jsonc</code> declares a D1 binding called <code>DB</code> with
  <code>database_name: "searchkeep"</code> but deliberately <em>no</em> <code>database_id</code>. On the first deploy,
  Wrangler provisions the database automatically. Its ID lives only in your Cloudflare account and is never written
  back to the repository, so syncing upstream never conflicts with your setup.
</p>
<p>
  <strong>Verify:</strong> <strong>Storage &amp; Databases → D1</strong> (or <code>npx wrangler d1 list</code>) lists a
  database named <code>searchkeep</code>. Its tables appear at the latest after the Worker’s first request.
</p>
<Callout kind="note" title="The Worker is locked at this point">
  <p>
    Until Access is configured in step 6, the Worker is in the <code>no_access</code> state: every page shows a public
    setup guide, <code>/api/*</code> and <code>/mcp</code> refuse requests, and the cron does not sync. That is expected.
  </p>
</Callout>

<h2 id="domain">5. Add a custom domain</h2>
<p>
  In the Worker’s <strong>Settings → Domains &amp; Routes</strong> (or its <strong>Domains</strong> tab), add a
  <strong>Custom domain</strong> such as <code>searchkeep.example.com</code>. Cloudflare creates the DNS record and the
  certificate. Then make sure the <strong>workers.dev</strong> route and <strong>Preview URLs</strong> are disabled.
</p>
<ul>
  <li>
    A custom domain is required, not cosmetic: the repository’s <code>wrangler.jsonc</code> turns off
    <code>workers_dev</code> and <code>preview_urls</code> on every deploy and declares no routes, and the Access
    application in step 6 attaches to this hostname. Adding the domain in the dashboard keeps it out of the repository,
    so it survives upgrades.
  </li>
  <li>
    With workers.dev and previews off, no hostname reaches the Worker except the one Access covers. The Worker would
    still reject requests without a valid Access JWT anywhere else, but there is no reason to leave the door visible.
  </li>
</ul>
<p><strong>Verify</strong> (the certificate can take a few minutes):</p>
<CodeBlock lang="bash" code={lockedCheck} />
<p>
  <code>/healthz</code> returns only <code>{'{"ok":true}'}</code>, opening <code>https://searchkeep.example.com/</code> in a
  browser shows the public “Searchkeep is locked” setup page, and the Worker’s <code>workers.dev</code> URL no longer
  answers.
</p>

<h2 id="access">6. Protect it with Cloudflare Access</h2>
<Callout kind="human" title="Human step, first time only">
  <p>
    If your account has never used Zero Trust, open <strong>Zero Trust</strong> in the Cloudflare dashboard and create
    your organization: choose a team name (this becomes <code>&lt;team&gt;.cloudflareaccess.com</code>) and the Free
    plan. One-time PIN login by email works out of the box. Everything after this can be done by an agent with the
    Cloudflare MCP server.
  </p>
</Callout>
<ol>
  <li>
    In <strong>Zero Trust → Access controls → Applications</strong> (older dashboards: <strong>Access →
    Applications</strong>), add a <strong>Self-hosted</strong> application for <code>searchkeep.example.com</code>,
    covering the whole hostname: no path, no bypass rules, no exceptions.
  </li>
  <li>
    Add one <strong>Allow</strong> policy whose include rule is <strong>Emails</strong> with your own address, or a short
    list of specific addresses. Searchkeep reads the policies through the API and stays locked
    (<code>policy_too_broad</code>) if one lets in Everyone, a public email domain such as <code>gmail.com</code>, any
    identity-provider login, every IP or a whole country, or uses Bypass or Service Auth.
  </li>
  <li>
    In the application’s <strong>Advanced settings</strong>, turn on <strong>Managed OAuth</strong> with dynamic client
    registration, and allow localhost and loopback clients (used by Claude Code, Cursor and other local clients). This
    makes Access the OAuth 2.1 authorization server for MCP clients, with PKCE. Without it, Searchkeep stays in
    <code>oauth_disabled</code>.
  </li>
  <li>
    Copy the application’s <strong>Application Audience (AUD) Tag</strong> and your team domain from
    <strong>Zero Trust → Settings</strong>, and store both as Worker Secrets:
  </li>
</ol>
<CodeBlock lang="bash" code={accessSecrets} />
<p>
  Values are prompted for interactively and never echoed. For <code>ACCESS_TEAM_DOMAIN</code> enter just the hostname.
  Both values must come from your Access configuration, never from a JWT the Worker received.
</p>
<p><strong>Verify:</strong></p>
<CodeBlock lang="bash" code={accessCheck} />
<p>
  Opening <code>https://searchkeep.example.com/</code> in a private window shows the Access login. After you sign in,
  the dashboard loads instead of the setup page and no longer reports <code>no_access</code>; it may report another
  state until the next step is done.
</p>

<h2 id="credentials">7. Add credentials</h2>
<p>
  The Cloudflare token is required: Searchkeep uses it to check your Access setup, and stays in
  <code>oauth_disabled</code> without it. Search Console and Bing are optional and independent; connect what you have and
  add the rest later. Setting a secret deploys a new version of the Worker within seconds; no build is needed.
</p>

<h3 id="cred-cloudflare">Cloudflare account ID and API token</h3>
<Callout kind="human" title="Human step (recommended)">
  <p>
    In <strong>My Profile → API Tokens → Create Token → Create Custom Token</strong>, name it
    <code>Searchkeep (read-only)</code> and grant these read-only permissions, with your account as the account resource
    and the zones of the sites you analyze (or all zones of the account) as zone resources:
  </p>
</Callout>
<div class="table-wrap">
  <table>
    <thead><tr><th>Scope</th><th>Permission</th><th>Used for</th></tr></thead>
    <tbody>
      <tr><td>Account</td><td>Account Analytics · Read</td><td>Web Analytics: page views, AI referrers, Web Vitals</td></tr>
      <tr><td>Zone</td><td>Analytics · Read</td><td>AI crawler requests on proxied zones</td></tr>
      <tr><td>Account</td><td>Access: Apps and Policies · Read</td><td>Checking that Access is configured safely</td></tr>
    </tbody>
  </table>
</div>
<p>The account ID is under <strong>Account details</strong> on the Workers &amp; Pages overview, or in <code>npx wrangler whoami</code>.</p>
<CodeBlock lang="bash" code={cloudflareSecrets} />

<h3 id="cred-sites">Sites</h3>
<p>
  <strong>Easiest:</strong> once the dashboard opens, go to <strong>Settings → Sites → Add site</strong>, type the
  domain and press <strong>Auto-fill</strong>. Searchkeep looks the domain up in Search Console, Bing and Cloudflare with
  the credentials above and fills in the identifiers it finds; you can also type them yourself. Sites added there are
  stored in your D1 database and can be edited or removed on the same page.
</p>
<p>
  <strong>Scripted setups and agents</strong> can instead describe the sites in a JSON array and store it in the
  <code>SITES</code> secret (sites from the secret show up read-only in the dashboard). Only <code>domain</code> is
  required; leave out the fields of sources you do not use. The full format, and where to find each identifier, is in
  <a href="/docs/configuration#sites">Configuration</a>. Keep the file outside your clone.
</p>
<CodeBlock lang="json" title="sites.json" code={SITES_EXAMPLE} />
<CodeBlock lang="bash" code={sitesSecret} />

<h3 id="cred-gsc">Google Search Console</h3>
<p>Searchkeep reads Search Console with a Google Cloud service account.</p>
<Callout kind="human" title="Human step (or an agent with gcloud)">
  <p>
    In the Google Cloud console, pick or create a project, enable the <strong>Google Search Console API</strong>, create a
    service account (no project roles needed) and download a JSON key. An agent with an authenticated
    <code>gcloud</code> can do the same:
  </p>
</Callout>
<CodeBlock lang="bash" code={gcloud} />
<Callout kind="human" title="Human step: add the service account in Search Console">
  <p>
    In Search Console, open each property’s <strong>Settings → Users and permissions → Add user</strong>, enter the
    service account’s email and choose <strong>Restricted</strong>. Restricted is enough for everything except
    submitting sitemaps (see <a href="/docs/configuration#writes">Enabling writes</a>). The Search Console API cannot add
    users, so this is always a human step.
  </p>
</Callout>
<CodeBlock lang="bash" code={gscSecrets} />
<p>
  <strong>Verify:</strong> <strong>Users and permissions</strong> lists the service account with Restricted permission.
  After step 8, <code>setup_status</code> reports that the service account can read each property.
</p>

<h3 id="cred-bing">Bing Webmaster Tools</h3>
<Callout kind="human" title="Human step: generate the key">
  <p>
    In Bing Webmaster Tools, open <strong>Settings → API access → API Key</strong> and generate a key (or copy the
    existing one). Each user has a single key that works for all their sites. The key can also submit URLs and remove
    sites, so treat it like a password; Searchkeep only reads.
  </p>
</Callout>
<CodeBlock lang="bash" code={bingSecret} />
<p><strong>Verify:</strong> the output lists your sites, including each <code>bingSiteUrl</code> from <code>SITES</code>.</p>

<h3 id="cred-optional">Optional settings</h3>
<p>
  <code>BRAND_REGEX</code> enables brand vs non-brand splits; <code>ENABLE_WRITES=true</code> registers
  <code>submit_sitemap</code> (and needs Full permission in Search Console). The sync budgets
  (<code>GSC_ROWS_PER_DAY</code>, <code>GSC_BACKFILL_MONTHS</code>, <code>SYNC_DAILY_WRITE_BUDGET</code>,
  <code>SYNC_MAX_CALLS_PER_RUN</code>) have defaults sized for the free plans. All of them are described in
  <a href="/docs/configuration#secrets">Configuration</a>.
</p>

<h2 id="verify">8. Verify and run the first sync</h2>
<p>
  Open the dashboard and its status page: it reads <code>GET /api/status</code>, which answers in every state once you
  are signed in, and names any failing readiness check. When it shows <code>ready</code>, connect an MCP client (see
  <a href="/docs/mcp">MCP server</a>); it should list {READ_ONLY_TOOLS.length} tools ({READ_ONLY_TOOLS.length + 1} with
  <code>ENABLE_WRITES=true</code>). Before <code>ready</code>, <code>/mcp</code> answers every request with a JSON-RPC
  error that explains the lock. Ask the client to run <code>setup_status</code>. You are done when it reports:
</p>
<ul>
  <li>readiness <code>ready</code>;</li>
  <li>every secret you intended to set as present;</li>
  <li>each configured source passing its probe for each site.</li>
</ul>
<p>
  The Access check is cached for up to five minutes; <code>GET /api/status?refresh=1</code> re-checks immediately. Once
  an authenticated request (opening the dashboard, or any MCP call) sees <code>ready</code>, the Worker records a ready
  flag in D1. From then on the cron, which runs <strong>every 15 minutes</strong>, syncs whatever is due. Each pass
  re-checks Access through the API first and locks again if Access was turned off or loosened.
</p>
<p>
  To start right away instead of waiting for the next pass, use <strong>Sync now</strong> in the dashboard’s Settings,
  or <code>POST /api/sync</code> from an authenticated session:
</p>
<CodeBlock lang="bash" code={firstSync} />
<p>
  Each pass does only what fits its call, time and write budgets and resumes on the next one, so a result of
  <code>partial</code> with “continues next run” is normal. Daily increments come first: Search Console’s recent days
  (it lags two to three days), Bing’s full weekly data, 30 days of AI crawler requests and 90 days of Web Analytics.
  The Search Console history backfill then runs one day at a time back 16 months; on the free D1 write quota that takes
  days to weeks.
</p>
<p>
  <strong>Verify:</strong> <code>setup_status</code> shows a recent sync without errors, and <code>list_sites</code>
  shows a date range for each connected dataset. Over the following days the Search Console range reaches back 16
  months.
</p>

<h2 id="with-an-agent">Deploy with an agent</h2>
<p>
  <a href={GITHUB.deployRunbook}>docs/deploy.md</a> is written for agents: every step is idempotent and has a check,
  and the steps only a person can do are marked so the agent stops and asks.
</p>
<p><strong>Before you paste, your agent needs:</strong></p>
<ul>
  {#each AGENT_PREREQS as p (p.title)}
    <li><strong>{p.title}</strong> (required). {p.text}</li>
  {/each}
  <li>
    And you need the accounts from <a href="#before-you-start">Before you start</a>: Cloudflare with your domain
    active, GitHub, and Owner access to your Search Console properties.
  </li>
</ul>
<p>Then copy this prompt into Claude Code, Cursor, Codex or any agent that can use MCP or a terminal:</p>
<CodeBlock lang="text" title="Prompt" code={AGENT_PROMPT} wrap />
<p>The steps that need you:</p>
<ol>
  <li>authorizing the Cloudflare GitHub App for the fork;</li>
  <li>creating the Zero Trust organization, the first time;</li>
  <li>creating the read-only Cloudflare API token (recommended as a human step);</li>
  <li>adding the service account in Search Console (and creating it, if the agent has no <code>gcloud</code>);</li>
  <li>generating the Bing Webmaster Tools API key;</li>
  <li>signing in through Access when you connect an MCP client or open the dashboard.</li>
</ol>
<Callout kind="warning" title="Keep secrets out of the chat">
  <p>
    Have the agent run <code>wrangler secret put</code> so values go straight from a file or prompt into Cloudflare. Do
    not paste API keys or private keys into the conversation.
  </p>
</Callout>

<h2 id="troubleshooting">Troubleshooting</h2>
<p>
  Start with the dashboard’s status page (<code>/api/status</code>), or <code>setup_status</code> once the deployment
  is <code>ready</code>: it names the failing check. The runbook’s
  <a href="{GITHUB.deployRunbook}#troubleshooting">troubleshooting section</a> covers every case in detail.
</p>
<dl>
  <dt>The dashboard only shows the setup guide (<code>no_access</code>)</dt>
  <dd>
    Either the request did not come through Access, or <code>ACCESS_TEAM_DOMAIN</code> / <code>ACCESS_AUD</code> are
    missing or wrong. Check that the Access application covers the exact hostname with no path, that the AUD tag is
    this application’s, and that you are not using a workers.dev or preview URL.
  </dd>
  <dt><code>oauth_disabled</code></dt>
  <dd>
    Managed OAuth is off, or Searchkeep cannot read the Access application. Turn Managed OAuth on, and check that
    <code>CLOUDFLARE_ACCOUNT_ID</code> is set and <code>CLOUDFLARE_API_TOKEN</code> has Access: Apps and Policies Read.
  </dd>
  <dt><code>policy_too_broad</code></dt>
  <dd>A policy lets in more than specific people. Keep one Allow policy that includes your email address.</dd>
  <dt>A source check fails</dt>
  <dd>
    For GSC, confirm the service account was added to that exact property and that <code>gscProperty</code> matches it
    (<code>sc-domain:</code> for domain properties). For Bing, confirm <code>bingSiteUrl</code> matches the site as
    registered. For AI crawler data, confirm the zone is proxied and the token has Zone Analytics Read.
  </dd>
  <dt>The build log says the remote migration was skipped</dt>
  <dd>
    Expected with the default build token, which has no D1 permission. The deploy continues and the Worker applies
    pending migrations itself. If the deploy itself failed, check the root directory (<code>apps/cloudflare</code>) and
    the project name (<code>searchkeep</code>).
  </dd>
  <dt>Sync units are reported as skipped after interrupted attempts</dt>
  <dd>
    A unit that is interrupted three times in a row, usually by the 10 ms CPU limit of Workers Free, is skipped so the
    sync never gets stuck. Lower <code>GSC_ROWS_PER_DAY</code>, or move to Workers Paid.
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

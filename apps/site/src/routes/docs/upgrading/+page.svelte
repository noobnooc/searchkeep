<script lang="ts">
  import Callout from '#lib/components/Callout.svelte';
  import CodeBlock from '#lib/components/CodeBlock.svelte';
  import { GITHUB } from '#lib/site.ts';

  const cli = `# Same as clicking "Sync fork", from a terminal with the GitHub CLI
gh repo sync <you>/searchkeep --source noobnooc/searchkeep --branch main`;
</script>

<h2 id="sync-fork">Sync your fork</h2>
<p>
  Upgrading is one click. Open your fork on GitHub and choose <strong>Sync fork → Update branch</strong>. That’s it.
</p>
<CodeBlock lang="bash" code={cli} />
<p>
  Read the <a href="/changelog">changelog</a> or <a href={GITHUB.releases}>GitHub releases</a> first. Every release that
  needs anything from you says so at the top.
</p>

<h2 id="what-happens">What happens next</h2>
<ol>
  <li>Workers Builds sees the new commit on <code>main</code> and starts a build.</li>
  <li>The build compiles the Worker and the dashboard.</li>
  <li>The deploy command applies any new D1 migrations, then deploys the new Worker version.</li>
  <li>Your secrets, the D1 database, the custom domain and Access are untouched.</li>
</ol>
<p>
  Because configuration lives in Worker Secrets and the D1 binding has no ID in the repository, your fork has no local
  changes and syncing never produces a merge conflict. <code>keep_vars: true</code> in <code>wrangler.jsonc</code> also
  keeps any plain variables you set in the dashboard.
</p>
<p>
  <strong>Verify:</strong> the build in <strong>Workers &amp; Pages → searchkeep → Deployments</strong> succeeded, and
  <code>setup_status</code> still reports <code>ready</code>.
</p>

<h2 id="migrations">Database migrations</h2>
<p>
  Since every fork deploys automatically on sync, a bad migration would reach everyone at once. Searchkeep treats
  migrations accordingly:
</p>
<ul>
  <li>Migrations are forward-only and safe to run more than once.</li>
  <li>CI applies each new migration to a database created by the previous release before it can merge.</li>
  <li>Migration files require review by a maintainer.</li>
</ul>

<h2 id="manual-steps">Releases with manual steps</h2>
<p>
  Occasionally a release needs something only you can do, such as adding a permission to the Cloudflare API token or
  setting a new secret. Such releases:
</p>
<ul>
  <li>list the step under <strong>Upgrade notes</strong> in the changelog and the GitHub release;</li>
  <li>are called out in the pull request that introduced them, so nothing reaches <code>main</code> without an upgrade note.</li>
</ul>
<Callout kind="note" title="Watch releases">
  <p>
    On the repository page, choose <strong>Watch → Custom → Releases</strong> to get notified of new versions and their
    upgrade notes.
  </p>
</Callout>

<h2 id="rollback">Rolling back</h2>
<p>
  Cloudflare keeps previous Worker versions. To roll back the code, open <strong>Deployments</strong> for the
  <code>searchkeep</code> Worker and roll back to an earlier version, or run <code>npx wrangler rollback --name
  searchkeep</code>.
</p>
<p>
  Rolling back does not undo database migrations, because migrations are forward-only. Check the changelog before
  rolling back across a release that includes one. If you need to rewind the data itself, D1 Time Travel can restore
  the database to an earlier point in time (up to 30 days back on Workers Paid, 7 on Workers Free).
</p>
<p>After any upgrade or rollback, run <code>setup_status</code> to confirm everything is still green.</p>

<h2 id="customizing">If you changed the code</h2>
<p>
  You are free to modify your fork. If you do, “Sync fork” may report conflicts, which you resolve like any other Git
  merge. To keep upgrades trivial, prefer configuration over code changes, and consider contributing generally useful
  changes upstream so they ship to everyone.
</p>

<script lang="ts">
  import Callout from '#lib/components/Callout.svelte';
  import CodeBlock from '#lib/components/CodeBlock.svelte';
  import { READINESS } from '#lib/content.ts';
  import { GITHUB } from '#lib/site.ts';

  const md = (s: string) =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/`([^`]+)`/g, '<code>$1</code>');

  const jwt = `GET /api/sites HTTP/1.1
Host: searchkeep.example.com
Cf-Access-Jwt-Assertion: eyJhbGciOiJSUzI1NiIsImtpZCI6Ij...

# The Worker verifies, on every request:
#   signature  against https://<ACCESS_TEAM_DOMAIN>/cdn-cgi/access/certs
#   iss        == https://<ACCESS_TEAM_DOMAIN>
#   aud        contains ACCESS_AUD
#   exp / nbf  within the allowed clock skew`;
</script>

<h2 id="model">Security model</h2>
<p>
  Searchkeep holds search data about your business and credentials for three APIs, so it is built to be safe without
  you having to get anything subtle right:
</p>
<ul>
  <li><strong>No application logins.</strong> Authentication is delegated entirely to Cloudflare Access. Searchkeep contains no password storage and no OAuth server code.</li>
  <li><strong>Defense in depth.</strong> Access blocks unauthenticated traffic at the edge, and the Worker independently verifies Access’s signed JWT on every request.</li>
  <li><strong>Fail closed.</strong> Until Access, Managed OAuth and a tight policy are all confirmed, no data is served and no sync runs.</li>
  <li><strong>Least privilege.</strong> Every credential is read-only by default. The one write action is opt-in.</li>
  <li><strong>Nothing leaves your account.</strong> No telemetry, no vendor backend.</li>
</ul>

<h2 id="access">Cloudflare Access</h2>
<p>
  A single <strong>self-hosted Access application</strong> covers the Worker’s whole hostname. People using the
  dashboard sign in through Access with whatever identity provider you configured (one-time PIN by email works out of the
  box) and then carry Access’s session cookie.
</p>
<p>
  The policy should allow only your own email or a short list of specific emails. Searchkeep reads your Access
  application and policies through the Cloudflare API (with <strong>Access: Apps and Policies Read</strong>) and refuses
  to serve data if a policy allows everyone or a public email domain such as <code>gmail.com</code>,
  <code>outlook.com</code> or <code>icloud.com</code>. The result of that check is cached for a few minutes and refreshed
  when the dashboard opens.
</p>

<h2 id="oauth">Managed OAuth for MCP</h2>
<p>
  MCP clients cannot use a browser cookie, so the Access application has <strong>Managed OAuth</strong> turned on. Access
  then acts as a complete OAuth 2.1 authorization server for your hostname:
</p>
<ul>
  <li><strong>Discovery.</strong> Clients find the authorization server from the MCP endpoint’s metadata.</li>
  <li><strong>Dynamic client registration.</strong> Each client registers itself; you never create or paste a client ID.</li>
  <li><strong>PKCE.</strong> Authorization codes are bound to the client that requested them.</li>
  <li><strong>Same policy.</strong> The OAuth login is an Access login, so it is governed by the same policy as the dashboard.</li>
</ul>
<p>
  If Managed OAuth is off, MCP clients would be redirected to an HTML login page they cannot complete. Searchkeep detects
  this through the API and reports <code>oauth_disabled</code> instead of failing mysteriously.
</p>

<h2 id="jwt">JWT re-verification</h2>
<p>
  Access adds a signed JWT to every request it lets through. The Worker does not trust that a request came through
  Access; it checks:
</p>
<CodeBlock lang="http" title="What the Worker checks" code={jwt} copy={false} />
<p>
  The keys are fetched from your team domain’s JWKS endpoint and cached. Because of this check, a request that reaches
  the Worker by any other route (a leftover workers.dev URL, a preview URL, a misconfigured route) carries no valid JWT
  and gets nothing.
</p>
<Callout kind="warning" title="Why the team domain and AUD are secrets you set">
  <p>
    Searchkeep never learns <code>ACCESS_TEAM_DOMAIN</code> or <code>ACCESS_AUD</code> from incoming traffic. If it
    trusted the first JWT it saw, an attacker could send a JWT signed by <em>their own</em> Access team to an unprotected
    URL and be accepted. Both values must come from Secrets you control.
  </p>
</Callout>
<p>
  The verification is a generic OIDC JWT check (issuer, JWKS URL, audience), so other identity-aware proxies can be
  supported later without changing the rest of the app.
</p>

<h2 id="readiness">Readiness states</h2>
<p>
  Readiness is computed from each request’s JWT plus a cached API check of your Access configuration. It is not a
  setting you flip, so if someone later disables Access or loosens the policy, Searchkeep locks itself again
  automatically.
</p>
<div class="table-wrap">
  <table>
    <thead>
      <tr><th>State</th><th>Condition</th><th>Dashboard</th><th>MCP and /api</th><th>Cron</th></tr>
    </thead>
    <tbody>
      {#each READINESS as r, i (r.id)}
        <tr>
          <td><span class="n">{i + 1}</span><code>{r.id}</code></td>
          <td>{@html md(r.condition)}</td>
          <td>{@html md(r.dashboard)}</td>
          <td>{@html md(r.api)}</td>
          <td>{r.cron}</td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>
<h3 id="cron-flag">Locked until ready, including the cron</h3>
<p>
  Cron Triggers are invoked by Cloudflare internally, carry no JWT and do not pass through Access. To keep the sync from
  running on an unprotected deployment, the Worker records a <strong>ready flag</strong> in D1 the first time a request
  is fully <code>ready</code>, and clears it whenever a check fails. The cron syncs only while the flag is set.
</p>

<h2 id="public">Public endpoints</h2>
<p>Two paths are served without a JWT, and neither exposes data:</p>
<div class="table-wrap">
  <table>
    <thead><tr><th>Path</th><th>Returns</th></tr></thead>
    <tbody>
      <tr><td><code>/setup</code></td><td>Generic setup steps. No data, no configuration values, no source status, and no action that writes anything.</td></tr>
      <tr><td><code>/healthz</code></td><td><code>{'{"ok":true}'}</code> and nothing else. Useful for uptime checks.</td></tr>
    </tbody>
  </table>
</div>
<p>
  Since Access covers the whole hostname, these are normally behind the Access login too. If you want an external
  uptime monitor to reach <code>/healthz</code>, add an Access <strong>Bypass</strong> policy for that path only.
</p>

<h2 id="credentials">Credentials</h2>
<ul>
  <li>All credentials are Worker Secrets: encrypted at rest, write-only after creation, never in the repository.</li>
  <li>Searchkeep never logs secret values; <code>setup_status</code> reports presence only.</li>
  <li>The GSC service account is a <strong>Restricted</strong> user unless you opt into writes.</li>
  <li>The Cloudflare token has read permissions only.</li>
  <li>The Bing API key cannot be scoped down; it can submit URLs and remove sites. Treat it like a password and rotate it if exposed.</li>
  <li>Third-party API access tokens (for example Google’s OAuth access token) are cached in memory only.</li>
</ul>

<h2 id="reporting">Reporting a vulnerability</h2>
<p>
  Please report security issues privately through
  <a href={GITHUB.security}>GitHub security advisories</a> on the repository, not in public issues. Include the version,
  a description and steps to reproduce.
</p>

<style>
  .n {
    display: inline-grid;
    place-items: center;
    width: 20px;
    height: 20px;
    margin-right: 8px;
    border-radius: 6px;
    border: 1px solid var(--line-2);
    font-size: 11px;
    color: var(--text-3);
    vertical-align: 1px;
  }
  td code {
    white-space: nowrap;
  }
</style>

/**
 * Public setup guide served while the deployment is locked. It contains only
 * generic steps — no data, no configuration values, no source status — and
 * offers no action that could write anything.
 */
/** The Searchkeep tile mark (docs/brand/icon.svg). */
const MARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="40" height="40" aria-hidden="true"><defs><linearGradient id="sk-setup-g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#a3ffb9"/><stop offset=".55" stop-color="#31eb91"/><stop offset="1" stop-color="#00cb87"/></linearGradient></defs><rect width="64" height="64" rx="16.64" fill="url(#sk-setup-g)"/><path transform="translate(10.24 10.24) scale(0.68)" fill="#04140c" d="M13 27H51V50.5a4.5 4.5 0 0 1 -4.5 4.5H37.5V45a5.5 5.5 0 0 0 -11 0V55H17.5a4.5 4.5 0 0 1 -4.5 -4.5zM13 24V21a3 3 0 0 1 3 -3H19.87a3 3 0 0 1 3 3V24zM27.07 24V15a3 3 0 0 1 3 -3H33.93a3 3 0 0 1 3 3V24zM41.13 24V9a3 3 0 0 1 3 -3H48a3 3 0 0 1 3 3V24z"/></svg>`;

export function setupPage(state: 'no_access' | 'oauth_disabled' | 'policy_too_broad' = 'no_access'): string {
  const title = 'Searchkeep is locked';
  const lead =
    state === 'oauth_disabled'
      ? 'Access is protecting this deployment, but Managed OAuth is not enabled yet, so MCP clients cannot connect.'
      : state === 'policy_too_broad'
        ? 'Access is protecting this deployment, but its policy lets in more than specific people.'
        : 'This Searchkeep deployment is not protected by Cloudflare Access yet. Until it is, the dashboard and MCP endpoint stay locked.';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${title}</title>
<style>
  :root { color-scheme: light dark; --bg:#0b0c0e; --fg:#e8e9ec; --muted:#9a9ca3; --line:#23252b; --card:#121317; --accent:#31eb91; }
  @media (prefers-color-scheme: light) { :root { --bg:#fafafa; --fg:#141518; --muted:#5d6068; --line:#e4e5e8; --card:#fff; --accent:#00995f; } }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font:15px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Inter, sans-serif; }
  main { max-width: 720px; margin: 0 auto; padding: 64px 20px 80px; }
  .brandrow { display:flex; align-items:center; gap:14px; }
  .brandrow svg { border-radius: 11px; box-shadow: 0 8px 24px -8px rgba(49,235,145,.5); }
  .badge { display:inline-flex; gap:8px; align-items:center; font-size:12px; letter-spacing:.02em; color:var(--muted); border:1px solid var(--line); border-radius:999px; padding:4px 10px; }
  .dot { width:7px; height:7px; border-radius:50%; background:#f5a524; box-shadow:0 0 0 3px rgba(245,165,36,.15); }
  h1 { font-size: 32px; letter-spacing: -0.02em; line-height:1.15; margin: 20px 0 12px; }
  p.lead { color: var(--muted); font-size: 16px; margin: 0 0 32px; }
  ol { list-style: none; counter-reset: s; padding: 0; margin: 0; display: grid; gap: 12px; }
  li { counter-increment: s; background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 16px 18px 16px 56px; position: relative; }
  li::before { content: counter(s); position: absolute; left: 18px; top: 16px; width: 24px; height: 24px; border-radius: 6px; display: grid; place-items: center; font-size: 12px; font-weight: 600; background: color-mix(in srgb, var(--accent) 18%, transparent); color: var(--accent); }
  li b { display:block; margin-bottom: 2px; }
  li span { color: var(--muted); }
  code { font: 13px ui-monospace, SFMono-Regular, Menlo, monospace; background: color-mix(in srgb, var(--fg) 8%, transparent); padding: 1px 5px; border-radius: 4px; }
  footer { margin-top: 40px; color: var(--muted); font-size: 13px; }
  a { color: var(--accent); }
</style>
</head>
<body>
<main>
  <div class="brandrow">${MARK_SVG}<span class="badge"><span class="dot"></span>Setup required</span></div>
  <h1>${title}</h1>
  <p class="lead">${lead}</p>
  <ol>
    <li><b>Use a custom domain</b><span>Add a custom domain to the Worker and turn off the <code>workers.dev</code> and preview URLs.</span></li>
    <li><b>Protect it with Cloudflare Access</b><span>In Zero Trust, create a self-hosted application for the whole hostname with an Allow policy that includes only your email address.</span></li>
    <li><b>Enable Managed OAuth</b><span>On the same Access application, enable Managed OAuth so MCP clients can sign in with dynamic client registration.</span></li>
    <li><b>Add the secrets</b><span>Set <code>ACCESS_TEAM_DOMAIN</code>, <code>ACCESS_AUD</code>, <code>CLOUDFLARE_ACCOUNT_ID</code>, <code>CLOUDFLARE_API_TOKEN</code> and <code>SITES</code>, plus the credentials for each data source.</span></li>
    <li><b>Reload</b><span>Sign in through Access and open this page again. The dashboard unlocks once every check passes.</span></li>
  </ol>
  <footer>Full guide: <a href="https://searchkeep.dev/docs/deploy">searchkeep.dev/docs/deploy</a> · Searchkeep is open source (MIT).</footer>
</main>
</body>
</html>`;
}

/**
 * Public setup guide served while the deployment is locked. It contains only
 * generic steps — no data, no configuration values, no source status — and
 * offers no action that could write anything.
 */
/** The Searchkeep app icon: the Horizon mark on a Night tile (docs/brand/icon.svg). */
const MARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="40" height="40" aria-hidden="true"><rect width="64" height="64" rx="15" fill="#0b0c0e"/><svg x="8.96" y="8.96" width="46.08" height="46.08" viewBox="0 0 48 48" fill="none"><line x1="17" y1="7" x2="17" y2="41" stroke="#ffffff" stroke-opacity="0.4" stroke-width="2" stroke-dasharray="2.5 3"/><polyline points="5,34 11,27 17,30 24,19 31,24 38,13" stroke="#ffffff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="38" cy="13" r="5" fill="#ff5b1f"/></svg></svg>`;

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
  :root { color-scheme: light dark; --bg:#0b0c0e; --fg:#f3f4f6; --muted:#8a9099; --faint:#646a73; --line:#23262c; --card:#121316; --accent:#ff7a45; --signal:#ff5b1f; }
  @media (prefers-color-scheme: light) { :root { --bg:#f6f7f9; --fg:#0b0c0e; --muted:#5b616b; --faint:#7d838d; --line:#e4e6ea; --card:#fff; --accent:#c2410c; } }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font:15px/1.6 Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; -webkit-font-smoothing: antialiased; }
  main { max-width: 720px; margin: 0 auto; padding: 64px 20px 80px; }
  .brandrow { display:flex; align-items:center; justify-content:space-between; gap:14px; }
  .mono { font-family: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
  .badge { display:inline-flex; gap:8px; align-items:center; border:1px solid var(--line); border-radius:999px; padding:4px 10px; }
  .dot { width:7px; height:7px; border-radius:50%; background:#f5a524; }
  .horizon { display:block; width:100%; height:auto; margin: 40px 0 8px; overflow: visible; }
  .horizon .rule { stroke: var(--line); }
  .horizon .cut { stroke: var(--faint); stroke-width: 1.25; stroke-dasharray: 3 5; }
  .horizon .kept { stroke: var(--fg); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
  .horizon .rest { stroke: var(--faint); stroke-width: 2; stroke-dasharray: 3 6; stroke-linecap: round; stroke-linejoin: round; }
  .horizon .end { fill: var(--bg); stroke: var(--faint); stroke-width: 1.5; }
  h1 { font-family: "Inter Tight", Inter, ui-sans-serif, system-ui, sans-serif; font-size: 34px; font-weight: 600; letter-spacing: -0.02em; line-height:1.15; margin: 28px 0 12px; }
  h1 i { font-style: normal; color: var(--signal); }
  p.lead { color: var(--muted); font-size: 16px; margin: 0 0 32px; }
  ol { list-style: none; counter-reset: s; padding: 0; margin: 0; display: grid; gap: 10px; }
  li { counter-increment: s; background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 16px 18px 16px 58px; position: relative; }
  li::before { content: counter(s, decimal-leading-zero); position: absolute; left: 18px; top: 17px; font: 500 12px/1.6 "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--muted); }
  li b { display:block; margin-bottom: 2px; font-weight: 600; }
  li span { color: var(--muted); }
  code { font: 13px "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace; background: color-mix(in srgb, var(--fg) 8%, transparent); padding: 1px 5px; border-radius: 4px; }
  footer { margin-top: 40px; color: var(--muted); font-size: 13px; }
  a { color: var(--accent); }
</style>
</head>
<body>
<main>
  <div class="brandrow">${MARK_SVG}<span class="badge mono"><span class="dot"></span>Setup required</span></div>
  <svg class="horizon" viewBox="0 0 480 56" fill="none" aria-hidden="true"><line class="rule" x1="0" y1="55.5" x2="480" y2="55.5"/><line class="cut" x1="208" y1="0" x2="208" y2="56"/><polyline class="kept" points="0,46 32,49 64,41 96,44 128,36 160,39 192,31 224,34 256,27 288,30"/><polyline class="rest" points="288,30 320,22 352,25 384,17 416,20 448,10"/><circle class="end" cx="448" cy="10" r="4.5"/></svg>
  <div class="mono">Sync paused until every check passes</div>
  <h1>${title}<i>.</i></h1>
  <p class="lead">${lead}</p>
  <ol>
    <li><b>Use a custom domain</b><span>Add a custom domain to the Worker and turn off the <code>workers.dev</code> and preview URLs.</span></li>
    <li><b>Protect it with Cloudflare Access</b><span>In Zero Trust, create a self-hosted application for the whole hostname with an Allow policy that includes only your email address.</span></li>
    <li><b>Enable Managed OAuth</b><span>On the same Access application, enable Managed OAuth so MCP clients can sign in with dynamic client registration.</span></li>
    <li><b>Add the secrets</b><span>Set <code>ACCESS_TEAM_DOMAIN</code>, <code>ACCESS_AUD</code>, <code>CLOUDFLARE_ACCOUNT_ID</code> and <code>CLOUDFLARE_API_TOKEN</code>, plus the credentials for each data source. Add your sites in the dashboard once it unlocks (or with the optional <code>SITES</code> secret).</span></li>
    <li><b>Reload</b><span>Sign in through Access and open this page again. The dashboard unlocks once every check passes.</span></li>
  </ol>
  <footer>Full guide: <a href="https://searchkeep.dev/docs/deploy">searchkeep.dev/docs/deploy</a> · Searchkeep is open source (MIT).</footer>
</main>
</body>
</html>`;
}

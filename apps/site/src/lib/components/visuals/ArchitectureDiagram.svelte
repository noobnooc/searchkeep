<figure
  class="arch"
  aria-label="Architecture diagram. Three callers reach one Worker named searchkeep in your Cloudflare account: MCP clients such as Claude, Cursor and ChatGPT call /mcp, you open the dashboard in a browser, and Cron Triggers start a sync pass every 15 minutes. MCP and dashboard requests pass through Cloudflare Access first; the cron is triggered internally. All three entrances call the same core, which reads and writes D1 through the Store interface and calls Google Search Console, Bing Webmaster Tools and Cloudflare APIs through source adapters."
>
  <div aria-hidden="true" class="inner">
    <div class="grid3 callers">
      <div class="caller"><span class="k">MCP clients</span><span class="s">Claude · Cursor · ChatGPT</span></div>
      <div class="caller"><span class="k">You</span><span class="s">in a browser</span></div>
      <div class="caller"><span class="k">Cron Triggers</span><span class="s">*/15 * * * *</span></div>
    </div>

    <div class="grid3 links"><i class="v"></i><i class="v"></i><i class="v"></i></div>

    <div class="grid3 gate">
      <div class="access">
        <span class="lock"></span>
        <span><b>Cloudflare Access</b> <span class="hide-xs">· login · Managed OAuth · signed JWT</span></span>
      </div>
      <div class="internal">internal trigger</div>
    </div>

    <div class="grid3 links"><i class="v"></i><i class="v"></i><i class="v"></i></div>

    <div class="account">
      <div class="tag">Your Cloudflare account</div>
      <div class="worker">
        <div class="tag tag-w"><span class="dot"></span>Worker · searchkeep</div>

        <div class="grid3 entrances">
          <div class="entry"><span class="k">MCP</span><code>/mcp</code></div>
          <div class="entry"><span class="k">Dashboard</span><code>/ · /api</code></div>
          <div class="entry"><span class="k">Sync</span><code>scheduled()</code></div>
        </div>

        <div class="grid3 links short"><i class="v"></i><i class="v"></i><i class="v"></i></div>

        <div class="core">
          <span class="k">@searchkeep/core</span>
          <span class="s">analysis · sync · readiness checks</span>
        </div>

        <div class="grid2 links short"><i class="v"></i><i class="v"></i></div>

        <div class="grid2">
          <div class="box"><span class="k">Store</span><code>store-d1</code></div>
          <div class="box"><span class="k">Sources</span><code>gsc · bing · cloudflare</code></div>
        </div>

        <div class="grid2 links short"><i class="v"></i><i class="v solid-none"></i></div>

        <div class="grid2">
          <div class="box db"><span class="k">D1 database</span><span class="s">history, kept forever</span></div>
          <div></div>
        </div>
      </div>
    </div>

    <div class="grid2 links out"><i class="v hidden"></i><i class="v"></i></div>
    <div class="grid2">
      <div></div>
      <div class="apis">
        <span>Search Console API</span>
        <span>Bing Webmaster API</span>
        <span>Cloudflare GraphQL</span>
      </div>
    </div>
  </div>
</figure>

<style>
  .arch {
    padding: clamp(16px, 3vw, 32px);
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
    background:
      radial-gradient(60% 50% at 50% 40%, var(--accent-soft), transparent 70%),
      var(--bg-elev);
    font-size: 13px;
    color: var(--text-2);
    overflow: hidden;
  }
  .inner {
    max-width: 760px;
    margin-inline: auto;
  }
  .grid3,
  .grid2 {
    display: grid;
    gap: clamp(8px, 2vw, 16px);
  }
  .grid3 {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  .grid2 {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .k {
    display: block;
    font-weight: 600;
    color: var(--text);
    letter-spacing: -0.01em;
  }
  .s,
  code {
    display: block;
    margin-top: 2px;
    font-size: 11.5px;
    color: var(--text-3);
    overflow-wrap: anywhere;
  }
  code {
    font-family: var(--font-mono);
    background: none;
    border: 0;
    padding: 0;
  }
  .caller,
  .entry,
  .box,
  .core {
    padding: 10px 12px;
    border: 1px solid var(--line-2);
    border-radius: 10px;
    background: var(--surface);
    text-align: center;
    box-shadow: var(--shadow-sm);
    transition: border-color 200ms, box-shadow 200ms;
  }
  .caller:hover,
  .entry:hover,
  .box:hover,
  .core:hover {
    border-color: var(--accent-line);
    box-shadow: 0 0 0 4px var(--accent-soft);
  }
  .links {
    height: 22px;
  }
  .links.short {
    height: 18px;
  }
  .v {
    position: relative;
    justify-self: center;
    width: 1px;
    height: 100%;
    background: var(--line-3);
    overflow: visible;
  }
  .v::after {
    content: '';
    position: absolute;
    left: -2px;
    top: 0;
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 8px var(--accent);
    animation: flow 2.4s linear infinite;
    opacity: 0;
  }
  .grid3 .v:nth-child(2)::after,
  .grid2 .v:nth-child(2)::after {
    animation-delay: 0.8s;
  }
  .grid3 .v:nth-child(3)::after {
    animation-delay: 1.6s;
  }
  .v.hidden,
  .v.solid-none {
    visibility: hidden;
  }
  @keyframes flow {
    0% {
      transform: translateY(-2px);
      opacity: 0;
    }
    20% {
      opacity: 1;
    }
    80% {
      opacity: 1;
    }
    100% {
      transform: translateY(18px);
      opacity: 0;
    }
  }
  .gate {
    align-items: stretch;
  }
  .access {
    grid-column: 1 / 3;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 9px 12px;
    border-radius: 10px;
    border: 1px solid var(--accent-line);
    background: var(--accent-soft);
    color: var(--text-2);
    text-align: center;
  }
  .access b {
    color: var(--text);
    font-weight: 600;
  }
  .lock {
    flex: none;
    width: 10px;
    height: 10px;
    border-radius: 3px;
    background: var(--accent);
  }
  .internal {
    display: grid;
    place-items: center;
    border: 1px dashed var(--line-3);
    border-radius: 10px;
    font-size: 11.5px;
    color: var(--text-3);
    text-align: center;
    padding: 6px;
  }
  .account {
    position: relative;
    padding: 30px clamp(8px, 2vw, 16px) clamp(8px, 2vw, 16px);
    border: 1px dashed var(--line-3);
    border-radius: 16px;
  }
  .worker {
    position: relative;
    padding: 34px clamp(8px, 2vw, 16px) clamp(10px, 2vw, 16px);
    border: 1px solid var(--line-2);
    border-radius: 13px;
    background: light-dark(rgb(255 255 255 / 0.6), rgb(255 255 255 / 0.015));
  }
  .tag {
    position: absolute;
    top: 8px;
    left: 14px;
    font-size: 11.5px;
    font-weight: 550;
    color: var(--text-3);
  }
  .tag-w {
    display: flex;
    align-items: center;
    gap: 7px;
    top: 10px;
    color: var(--text);
  }
  .tag-w .dot {
    width: 7px;
    height: 7px;
    border-radius: 2px;
    background: var(--accent);
  }
  .core {
    border-color: var(--accent-line);
    background: linear-gradient(180deg, var(--accent-soft), transparent), var(--surface);
  }
  .db {
    border-style: solid;
  }
  .apis {
    display: grid;
    gap: 4px;
    padding: 9px 12px;
    border: 1px dashed var(--line-3);
    border-radius: 10px;
    font-size: 11.5px;
    color: var(--text-3);
    text-align: center;
  }
  @media (max-width: 560px) {
    .arch {
      font-size: 12px;
    }
    .caller,
    .entry,
    .box,
    .core {
      padding: 8px 6px;
    }
    .hide-xs {
      display: none;
    }
  }
</style>

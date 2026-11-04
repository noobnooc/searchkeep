<script lang="ts">
  import Window from './Window.svelte';

  const pages = [
    { path: '/blog/pricing-models-explained', req: 2876, note: 'GPTBot, ClaudeBot' },
    { path: '/changelog', req: 1987, note: 'OAI-SearchBot' },
    { path: '/blog/2024-roadmap', req: 1640, note: 'PerplexityBot' },
    { path: '/legal/terms', req: 1611, note: 'GPTBot' },
    { path: '/docs/sdk/v1', req: 1367, note: '38% returned 404' },
  ];
  const max = pages[0]!.req;
</script>

<Window
  title="Claude · Searchkeep connected"
  label="A chat where the user asks which pages AI crawlers hit but never get cited. The assistant calls the Searchkeep geo_funnel tool and lists five pages with 9,481 AI crawler requests and zero citations, then suggests fixes."
>
  <div class="chat">
    <div class="msg user">
      <div class="bubble">Which pages do AI crawlers hit but never get cited?</div>
    </div>

    <div class="msg bot">
      <div class="tool">
        <span class="tool-icon"></span>
        <span class="tool-name">searchkeep · geo_funnel</span>
        <code class="tool-args">days: 28, sortBy: "crawled"</code>
        <span class="tool-ok">read-only</span>
      </div>

      <p>Five pages took <b>9,481</b> AI crawler requests in the last 28 days without a single citation:</p>

      <ol class="list">
        {#each pages as p, i (p.path)}
          <li style="--w: {(p.req / max) * 100}%; --i: {i}">
            <span class="path">{p.path}</span>
            <span class="bar"><i></i></span>
            <span class="num">{p.req.toLocaleString('en-US')}</span>
            <span class="note">{p.note}</span>
          </li>
        {/each}
      </ol>

      <div class="tool small">
        <span class="tool-icon"></span>
        <span class="tool-name">searchkeep · ai_crawlers</span>
        <code class="tool-args">pathContains: "/docs/sdk/v1", groupBy: ["crawler", "status"]</code>
      </div>

      <p>
        <code>/docs/sdk/v1</code> mostly returns 404 to OAI-SearchBot, so redirect it to <code>/docs/sdk</code>.
        The pricing post is your most-crawled uncited page and has no direct answer above the fold. Want me to pull
        its top queries with <code>query_performance</code>?
      </p>
    </div>

    <div class="composer">
      <span>Ask about your search data…</span>
      <span class="send"></span>
    </div>
  </div>
</Window>

<style>
  .chat {
    display: grid;
    gap: 16px;
    padding: 20px;
    font-size: 13.5px;
    line-height: 1.6;
    color: var(--text-2);
    text-align: left;
  }
  .msg.user {
    display: flex;
    justify-content: flex-end;
  }
  .bubble {
    max-width: 80%;
    padding: 10px 14px;
    border-radius: 14px 14px 4px 14px;
    background: var(--surface-2);
    border: 1px solid var(--line);
    color: var(--text);
  }
  .bot {
    display: grid;
    gap: 12px;
  }
  .bot b {
    color: var(--text);
    font-weight: 600;
  }
  .bot code {
    font-size: 0.86em;
    padding: 0.1em 0.35em;
    border-radius: 5px;
    background: var(--surface-2);
    border: 1px solid var(--line);
    color: var(--text);
  }
  .tool {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px 10px;
    padding: 8px 12px;
    border: 1px solid var(--line-2);
    border-radius: 10px;
    background: var(--surface);
    font-size: 12px;
  }
  .tool.small {
    opacity: 0.85;
  }
  /* The Signal dot marks a Searchkeep tool call. */
  .tool-icon {
    width: 8px;
    height: 8px;
    margin-inline: 3px;
    border-radius: 50%;
    background: var(--signal);
  }
  .tool-name {
    font-weight: 550;
    color: var(--text);
  }
  .tool .tool-args {
    border: 0;
    background: none;
    padding: 0;
    color: var(--text-3);
    font-size: 11.5px;
  }
  .tool-ok {
    margin-left: auto;
    font-size: 11px;
    color: var(--accent);
  }
  .list {
    list-style: none;
    padding: 0;
    display: grid;
    gap: 2px;
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 6px;
    background: var(--surface);
  }
  .list li {
    display: grid;
    grid-template-columns: minmax(0, 1.7fr) minmax(0, 1fr) auto;
    grid-template-rows: auto auto;
    column-gap: 12px;
    align-items: center;
    padding: 6px 8px;
    border-radius: 7px;
  }
  .list li:hover {
    background: var(--surface-2);
  }
  .path {
    font-family: var(--font-mono);
    font-size: 11.5px;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .bar {
    height: 6px;
    border-radius: 3px;
    background: var(--surface-2);
    overflow: hidden;
  }
  .bar i {
    display: block;
    width: var(--w);
    height: 100%;
    border-radius: 3px;
    background: color-mix(in oklch, var(--accent-fill) 70%, var(--surface-3));
    transform-origin: left;
    animation: grow 900ms var(--ease) both;
    animation-delay: calc(var(--i) * 90ms + 300ms);
  }
  .num {
    font-variant-numeric: tabular-nums;
    color: var(--text);
    font-weight: 550;
    font-size: 12px;
    text-align: right;
  }
  .note {
    grid-column: 1 / -1;
    font-size: 11px;
    color: var(--text-4);
  }
  @keyframes grow {
    from {
      transform: scaleX(0);
    }
  }
  .composer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 4px;
    padding: 10px 10px 10px 14px;
    border: 1px solid var(--line-2);
    border-radius: 12px;
    background: var(--surface);
    color: var(--text-4);
    font-size: 13px;
  }
  .send {
    width: 26px;
    height: 26px;
    border-radius: 8px;
    background: var(--accent-fill);
    opacity: 0.9;
  }
  @media (max-width: 480px) {
    .chat {
      padding: 14px;
      font-size: 13px;
    }
    .list li {
      grid-template-columns: minmax(0, 1fr) auto;
    }
    .bar {
      display: none;
    }
  }
</style>

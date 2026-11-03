<script lang="ts">
  import Window from './Window.svelte';

  type Step = { kind: 'done' | 'human' | 'final'; tool?: string; text: string };
  const steps: Step[] = [
    { kind: 'done', tool: 'github.fork_repository', text: 'Forked noobnooc/searchkeep to acme/searchkeep' },
    { kind: 'human', text: 'Authorize the Cloudflare GitHub App for acme/searchkeep, then reply “done”.' },
    { kind: 'done', tool: 'cloudflare.builds', text: 'Connected Workers Builds · root apps/cloudflare' },
    { kind: 'done', tool: 'cloudflare.builds', text: 'First build passed · D1 “searchkeep” created' },
    { kind: 'done', tool: 'cloudflare.workers', text: 'Custom domain searchkeep.acme.com · workers.dev off' },
    { kind: 'done', tool: 'cloudflare.access', text: 'Access app + policy (you@acme.com) · Managed OAuth on' },
    { kind: 'done', tool: 'wrangler secret put', text: 'Set 8 secrets · values never printed' },
    { kind: 'final', tool: 'searchkeep.setup_status', text: 'ready · 3 sources connected · backfill started' },
  ];
</script>

<Window
  tone="terminal"
  title="claude — ~/acme"
  label="An AI agent transcript deploying Searchkeep: it forks the repository, asks the human to authorize the Cloudflare GitHub App, connects Workers Builds, creates the D1 database through the first build, adds a custom domain, configures Access with Managed OAuth, sets secrets, and finally calls setup_status, which reports ready."
>
  <div class="term">
    <div class="prompt"><span class="caret">›</span> Deploy Searchkeep for acme.com to my Cloudflare account.</div>
    <ol>
      {#each steps as s, i (i)}
        <li class={s.kind} style="--i: {i}">
          <span class="ico"></span>
          <span class="txt">
            {#if s.tool}<span class="tool">{s.tool}</span>{/if}
            <span>{s.text}</span>
          </span>
        </li>
      {/each}
    </ol>
    <div class="out">
      Searchkeep is live at <b>searchkeep.acme.com</b>. Add <b>https://searchkeep.acme.com/mcp</b> as a connector and
      ask away.
    </div>
  </div>
</Window>

<style>
  .term {
    padding: 18px 20px 20px;
    font-family: var(--font-mono);
    font-size: 12.5px;
    line-height: 1.6;
    color: var(--text-2);
    text-align: left;
  }
  .prompt {
    color: var(--text);
    padding-bottom: 12px;
    margin-bottom: 12px;
    border-bottom: 1px solid var(--line);
  }
  .caret {
    color: var(--accent);
    margin-right: 6px;
  }
  ol {
    list-style: none;
    padding: 0;
    display: grid;
    gap: 7px;
  }
  li {
    display: grid;
    grid-template-columns: 16px minmax(0, 1fr);
    gap: 10px;
    align-items: start;
    animation: in 500ms var(--ease) both;
    animation-delay: calc(var(--i) * 120ms + 200ms);
  }
  @keyframes in {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
  }
  .ico {
    width: 14px;
    height: 14px;
    margin-top: 3px;
    border-radius: 50%;
    border: 1.5px solid var(--accent);
    position: relative;
  }
  .done .ico::after,
  .final .ico::after {
    content: '';
    position: absolute;
    inset: 3px;
    border-radius: 50%;
    background: var(--accent);
  }
  .human .ico {
    border-color: var(--warn);
    border-radius: 4px;
  }
  .txt {
    display: flex;
    flex-wrap: wrap;
    gap: 0 10px;
    min-width: 0;
  }
  .tool {
    color: var(--text-3);
  }
  .human .txt {
    color: var(--warn);
  }
  .human .txt::before {
    content: 'You';
    font-weight: 700;
    margin-right: 2px;
  }
  .final .txt {
    color: var(--accent);
  }
  .out {
    margin-top: 14px;
    padding-top: 12px;
    border-top: 1px solid var(--line);
    font-family: var(--font-sans);
    font-size: 13.5px;
    color: var(--text-2);
  }
  .out b {
    color: var(--text);
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  @media (max-width: 480px) {
    .term {
      padding: 14px;
      font-size: 11.5px;
    }
  }
</style>

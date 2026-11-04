<script lang="ts">
  // A request on its way to your data: through Cloudflare Access, the Worker's own JWT check and
  // the setup checks. One request passes and lights each gate; another is refused at Access.
  // CSS only; the moving parts are hidden for reduced motion.
  import Icon, { type IconName } from '../Icon.svelte';
  import { READINESS } from '../../content';

  const nodes: { key: string; icon: IconName; title: string; sub: string }[] = [
    { key: 'g1', icon: 'lock', title: 'Cloudflare Access', sub: 'Sign-in · Managed OAuth for MCP' },
    { key: 'g2', icon: 'shield', title: 'JWT re-verified', sub: 'On every request' },
    { key: 'g3', icon: 'key', title: 'Setup checks', sub: 'Locks again if one breaks' },
    { key: 'to', icon: 'database', title: 'Your data', sub: 'Dashboard, MCP and sync' },
  ];
</script>

<div class="gate card">
  <div class="path">
    <div class="track" aria-hidden="true">
      <span class="pass"></span>
      <span class="refused"></span>
    </div>
    <ol>
      <li class="node from">
        <span class="tile">
          <span class="marks"><Icon name="claude" size={13} /><Icon name="cursor" size={13} /><Icon name="openai" size={13} /></span>
        </span>
        <h3>A request</h3>
        <span class="sub">MCP client or browser</span>
      </li>
      {#each nodes as n (n.key)}
        <li class="node {n.key}">
          <span class="tile"><Icon name={n.icon} size={18} /></span>
          <h3>{n.title}</h3>
          <span class="sub">{n.sub}</span>
        </li>
      {/each}
    </ol>
  </div>

  <ol class="states" aria-label="Readiness states">
    {#each READINESS as r (r.id)}
      <li class:ready={r.id === 'ready'} title={r.label}>
        <Icon name={r.id === 'ready' ? 'check' : 'lock'} size={12} />
        <code>{r.id}</code>
      </li>
    {/each}
    <li class="foot">Nothing is served or synced until <code>ready</code>.</li>
  </ol>
</div>

<style>
  .gate {
    padding: 30px 28px 22px;
  }
  .path {
    position: relative;
  }
  .path ol {
    position: relative;
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
  }
  .node {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    min-width: 0;
    padding-inline: 6px;
  }
  .tile {
    display: grid;
    place-items: center;
    width: 48px;
    height: 48px;
    border-radius: 14px;
    border: 1px solid var(--line-2);
    background: var(--bg-elev);
    color: var(--text-2);
  }
  .marks {
    display: grid;
    grid-template-columns: repeat(2, 13px);
    gap: 3px;
    justify-items: center;
  }
  .marks :global(svg:last-child) {
    grid-column: 1 / -1;
  }
  .to .tile {
    color: var(--accent-text);
    border-color: var(--accent-line);
    background: var(--accent-soft);
  }
  .node h3 {
    margin-top: 14px;
    font-size: 0.9375rem;
    letter-spacing: -0.01em;
  }
  .sub {
    margin-top: 4px;
    font-size: var(--fs-xs);
    color: var(--text-3);
    line-height: 1.45;
  }

  /* The line the requests travel along, behind the tiles' centers (10% to 90%). */
  .track {
    position: absolute;
    top: 24px;
    left: 10%;
    right: 10%;
    height: 0;
    border-top: 1px dashed var(--line-3);
  }
  .pass,
  .refused {
    position: absolute;
    top: -3.5px;
    left: 0;
    width: 6px;
    height: 6px;
    margin-left: -3px;
    border-radius: 50%;
    opacity: 0;
  }
  .pass {
    background: var(--signal);
  }
  .refused {
    background: var(--warn);
  }

  .states {
    list-style: none;
    margin: 28px 0 0;
    padding: 16px 0 0;
    border-top: 1px solid var(--line);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }
  .states li:not(.foot) {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 26px;
    padding-inline: 9px;
    border: 1px solid var(--line-2);
    border-radius: 999px;
    color: var(--text-3);
  }
  .states li:not(.foot) + li:not(.foot) {
    margin-left: 14px;
  }
  .states li:not(.foot) + li:not(.foot)::before {
    content: '';
    position: absolute;
    top: 50%;
    left: -19px;
    width: 14px;
    height: 1px;
    background: var(--line-3);
  }
  .states code {
    padding: 0;
    border: 0;
    background: none;
    font-size: 0.75rem;
    color: inherit;
  }
  .states li.ready {
    color: var(--accent-ink);
    background: var(--accent-fill);
    border-color: transparent;
  }
  .foot {
    margin-left: auto;
    font-size: var(--fs-xs);
    color: var(--text-3);
  }
  .foot code {
    color: var(--text-2);
  }

  @media (prefers-reduced-motion: no-preference) {
    .pass {
      animation: pass 6s linear infinite;
    }
    .refused {
      animation: refused 6s linear infinite;
    }
    .g1 .tile {
      animation: hit-g1 6s linear infinite;
    }
    .g2 .tile {
      animation: hit-g2 6s linear infinite;
    }
    .g3 .tile {
      animation: hit-g3 6s linear infinite;
    }
    .to .tile {
      animation: hit-to 6s linear infinite;
    }
  }
  /* One cycle: the passing request crosses gates at 15%, 30%, 45% and arrives at 60%;
     the refused one leaves at 48% and stops at Access at 62%. */
  @keyframes pass {
    0% {
      left: 0%;
      opacity: 0;
    }
    3% {
      opacity: 1;
    }
    60% {
      left: 100%;
      opacity: 1;
    }
    64%,
    100% {
      left: 100%;
      opacity: 0;
    }
  }
  @keyframes refused {
    0%,
    48% {
      left: 0%;
      opacity: 0;
    }
    51% {
      opacity: 1;
    }
    62% {
      left: calc(25% - 30px);
      opacity: 1;
    }
    72%,
    100% {
      left: calc(25% - 30px);
      opacity: 0;
    }
  }
  @keyframes hit-g1 {
    0%,
    12%,
    22%,
    59%,
    72%,
    100% {
      box-shadow: 0 0 0 0 transparent;
      border-color: var(--line-2);
    }
    15% {
      box-shadow: 0 0 0 4px var(--accent-soft);
      border-color: var(--accent-line);
    }
    62% {
      box-shadow: 0 0 0 4px var(--warn-soft);
      border-color: var(--warn);
    }
  }
  @keyframes hit-g2 {
    0%,
    27%,
    37%,
    100% {
      box-shadow: 0 0 0 0 transparent;
      border-color: var(--line-2);
    }
    30% {
      box-shadow: 0 0 0 4px var(--accent-soft);
      border-color: var(--accent-line);
    }
  }
  @keyframes hit-g3 {
    0%,
    42%,
    52%,
    100% {
      box-shadow: 0 0 0 0 transparent;
      border-color: var(--line-2);
    }
    45% {
      box-shadow: 0 0 0 4px var(--accent-soft);
      border-color: var(--accent-line);
    }
  }
  @keyframes hit-to {
    0%,
    57%,
    72%,
    100% {
      box-shadow: 0 0 0 0 transparent;
    }
    60% {
      box-shadow: 0 0 0 6px var(--accent-soft);
    }
  }

  @media (max-width: 760px) {
    .gate {
      padding: 20px;
    }
    .path ol {
      grid-template-columns: minmax(0, 1fr);
      gap: 14px;
    }
    .node {
      display: grid;
      grid-template-columns: 48px minmax(0, 1fr);
      grid-template-rows: auto auto;
      column-gap: 14px;
      align-items: center;
      text-align: left;
      padding: 0;
    }
    .tile {
      grid-row: 1 / 3;
    }
    .node h3 {
      margin-top: 0;
      align-self: end;
    }
    .sub {
      margin-top: 2px;
      align-self: start;
    }
    .track {
      display: none;
    }
    .states li:not(.foot) + li:not(.foot) {
      margin-left: 0;
    }
    .states li:not(.foot) + li:not(.foot)::before {
      display: none;
    }
    .foot {
      margin-left: 0;
      width: 100%;
    }
  }
</style>

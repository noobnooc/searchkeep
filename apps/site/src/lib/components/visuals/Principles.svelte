<script lang="ts">
  // The four principles, each shown as a small picture of what it means in practice.
  import Icon from '../Icon.svelte';
  import { PRINCIPLES } from '../../content';

  const [own, readOnly, free, upgrade] = PRINCIPLES as [
    (typeof PRINCIPLES)[number],
    (typeof PRINCIPLES)[number],
    (typeof PRINCIPLES)[number],
    (typeof PRINCIPLES)[number],
  ];
</script>

<ul class="principles">
  <li class="card">
    <div class="pic own" aria-hidden="true">
      <div class="acct">
        <span class="acct-tag">Your account</span>
        <span class="chip"><Icon name="cloudflare" size={13} /> Worker</span>
        <span class="chip"><Icon name="database" size={13} /> D1</span>
      </div>
      <span class="cut"><span class="x"><Icon name="x" size={11} /></span></span>
      <div class="ghost">Vendor server</div>
    </div>
    <h3>{own.title}</h3>
  </li>

  <li class="card">
    <div class="pic ro" aria-hidden="true">
      <div class="reads">
        {#each Array.from({ length: 12 }) as _, i (i)}<span></span>{/each}
        <em>12 read</em>
      </div>
      <div class="write">
        <code>submit_sitemap</code>
        <span class="switch"><span></span></span>
      </div>
    </div>
    <h3>{readOnly.title}</h3>
  </li>

  <li class="card">
    <div class="pic free" aria-hidden="true">
      <div class="meter"><span class="lbl">D1 writes / day</span><span class="bar"><i style:--v="62%"></i></span></div>
      <div class="meter"><span class="lbl">Requests / day</span><span class="bar"><i style:--v="18%"></i></span></div>
      <span class="limit">Free plan</span>
    </div>
    <h3>{free.title}</h3>
  </li>

  <li class="card">
    <div class="pic up" aria-hidden="true">
      <div class="gh">
        <Icon name="github" size={13} />
        <span>3 commits behind <code>main</code></span>
        <span class="sync"><Icon name="refresh" size={12} /> Sync fork</span>
      </div>
      <div class="built"><Icon name="check" size={12} /> Workers Builds · deployed</div>
    </div>
    <h3>{upgrade.title}</h3>
  </li>
</ul>

<style>
  .principles {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 14px;
  }
  .principles li {
    display: flex;
    flex-direction: column;
    padding: 18px;
  }
  .pic {
    position: relative;
    height: 116px;
    padding: 14px;
    border: 1px solid var(--line);
    border-radius: 12px;
    background: var(--surface);
    font-size: var(--fs-xs);
    color: var(--text-2);
  }
  h3 {
    margin-top: 16px;
    font-size: 1rem;
    line-height: 1.35;
    letter-spacing: -0.015em;
  }
  code {
    padding: 0;
    border: 0;
    background: none;
    font-size: 0.6875rem;
    color: var(--text);
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 22px;
    padding-inline: 7px;
    border: 1px solid var(--line-2);
    border-radius: 6px;
    background: var(--bg-elev);
    color: var(--text);
  }

  /* Your data never leaves your account. */
  .own {
    display: flex;
    align-items: center;
  }
  .acct {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 14px 10px 10px;
    border: 1px dashed var(--accent-line);
    border-radius: 9px;
  }
  .acct-tag {
    position: absolute;
    top: -8px;
    left: 8px;
    padding: 0 4px;
    background: var(--surface);
    font-family: var(--font-mono);
    font-size: 9.5px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--accent-text);
  }
  .cut {
    position: relative;
    flex: 1;
    height: 0;
    border-top: 1px dashed var(--line-3);
    margin-inline: 4px;
  }
  .x {
    position: absolute;
    top: -9px;
    left: 50%;
    display: grid;
    place-items: center;
    width: 17px;
    height: 17px;
    margin-left: -8.5px;
    border-radius: 50%;
    border: 1px solid var(--line-3);
    background: var(--surface);
    color: var(--text-3);
  }
  .ghost {
    padding: 8px;
    border: 1px dashed var(--line-2);
    border-radius: 8px;
    color: var(--text-4);
    text-decoration: line-through;
    white-space: nowrap;
  }

  /* Read-only by default. */
  .ro {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
  }
  .reads {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
  }
  .reads span {
    width: 10px;
    height: 10px;
    border-radius: 3px;
    background: var(--text-4);
  }
  .reads em {
    margin-left: 6px;
    font-style: normal;
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--text-3);
  }
  .write {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 10px;
    border: 1px dashed var(--line-2);
    border-radius: 8px;
  }
  .switch {
    position: relative;
    flex: none;
    width: 28px;
    height: 16px;
    border-radius: 999px;
    background: var(--line-2);
  }
  .switch span {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--text-3);
  }

  /* Free-tier friendly. */
  .free {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 12px;
  }
  .meter {
    display: grid;
    gap: 5px;
  }
  .lbl {
    color: var(--text-3);
  }
  .bar {
    position: relative;
    display: block;
    height: 6px;
    border-radius: 3px;
    background: var(--line);
  }
  .bar i {
    display: block;
    width: var(--v);
    height: 100%;
    border-radius: 3px;
    background: var(--text-3);
  }
  /* The free plan's daily limit is the end of each track. */
  .bar::after {
    content: '';
    position: absolute;
    top: -3px;
    right: 0;
    width: 1.5px;
    height: 12px;
    background: var(--accent);
  }
  .limit {
    position: absolute;
    top: 10px;
    right: 12px;
    font-family: var(--font-mono);
    font-size: 9.5px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--accent-text);
  }

  /* Upgrade = Sync fork. */
  .up {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 10px;
  }
  .gh {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 7px;
    color: var(--text-2);
  }
  .sync {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 22px;
    padding-inline: 8px;
    border: 1px solid var(--line-3);
    border-radius: 6px;
    background: var(--bg-elev);
    color: var(--text);
    font-weight: 600;
  }
  .built {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--accent-text);
  }

  @media (max-width: 1100px) {
    .principles {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  @media (max-width: 560px) {
    .principles {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>

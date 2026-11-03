<script lang="ts">
  // Months from Jul 2025 (index 0). Deploy in Nov 2026 (16), "today" two years later (40).
  const SPAN = 43;
  const x = (m: number) => `${(m / SPAN) * 100}%`;
  const w = (a: number, b: number) => `${((b - a) / SPAN) * 100}%`;
  const years = [
    { label: '2026', m: 6 },
    { label: '2027', m: 18 },
    { label: '2028', m: 30 },
  ];
</script>

<figure
  class="timeline"
  aria-label="Timeline. You deploy Searchkeep in November 2026 and it backfills 16 months of Search Console data, back to July 2025. Two years later, Google Search Console still shows only the most recent 16 months, July 2027 to November 2028, while Searchkeep holds all 40 months from July 2025."
>
  <div class="plot" aria-hidden="true">
    <div class="years">
      {#each years as y (y.label)}
        <span class="year" style="left: {x(y.m)}">{y.label}</span>
      {/each}
    </div>

    <div class="row">
      <div class="row-label">Google Search Console</div>
      <div class="track">
        <div class="seg gone" style="left: 0; width: {w(0, 24)}"></div>
        <div class="seg gsc" style="left: {x(24)}; width: {w(24, 40)}">
          <span class="in">16 months</span>
        </div>
      </div>
    </div>

    <div class="row">
      <div class="row-label">Searchkeep, in your D1</div>
      <div class="track">
        <div class="seg backfill" style="left: 0; width: {w(0, 16)}">
          <span class="in">Backfill</span>
        </div>
        <div class="seg kept" style="left: {x(16)}; width: {w(16, 40)}">
          <span class="in">Synced daily, kept</span>
        </div>
        <div class="seg future" style="left: {x(40)}; width: {w(40, 43)}"></div>
      </div>
    </div>

    <div class="marker deploy" style="left: {x(16)}"><span>You deploy</span></div>
    <div class="marker today" style="left: {x(40)}"><span>Today</span></div>
  </div>

  <figcaption class="legend">
    <span><i class="sw gone"></i>Dropped by Google after 16 months</span>
    <span><i class="sw backfill"></i>Backfilled on first sync</span>
    <span><i class="sw kept"></i>Synced daily, never deleted</span>
  </figcaption>
</figure>

<style>
  .timeline {
    padding: 28px 28px 22px;
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
    background: var(--bg-elev);
  }
  .plot {
    position: relative;
    padding-top: 30px;
    padding-bottom: 32px;
  }
  .years {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .year {
    position: absolute;
    top: 0;
    bottom: 32px;
    padding-left: 6px;
    border-left: 1px dashed var(--line-2);
    font-size: var(--fs-xs);
    color: var(--text-4);
    font-variant-numeric: tabular-nums;
  }
  .row + .row {
    margin-top: 22px;
  }
  .row-label {
    display: inline-block;
    position: relative;
    z-index: 1;
    margin-bottom: 8px;
    padding-right: 8px;
    background: var(--bg-elev);
    font-size: var(--fs-sm);
    color: var(--text);
    font-weight: 550;
  }
  .track {
    position: relative;
    height: 30px;
    border-radius: 8px;
    background: var(--surface-2);
    box-shadow: 0 0 0 1px var(--line) inset;
  }
  .seg {
    position: absolute;
    top: 0;
    bottom: 0;
    display: flex;
    align-items: center;
    padding-inline: 10px;
    border-radius: 8px;
    overflow: hidden;
  }
  .seg + .seg {
    /* 2px surface gap between adjacent fills */
    box-shadow: -2px 0 0 0 var(--bg-elev);
  }
  .in {
    font-size: 11.5px;
    font-weight: 550;
    white-space: nowrap;
    color: var(--accent-ink);
  }
  .gone,
  .sw.gone {
    background: repeating-linear-gradient(
      135deg,
      var(--surface-3) 0 6px,
      transparent 6px 11px
    );
  }
  .gsc {
    background: light-dark(#c9ccd1, #3a3d44);
  }
  .gsc .in {
    color: var(--text);
  }
  .backfill,
  .sw.backfill {
    background: color-mix(in oklch, var(--accent-fill) 50%, var(--surface-3));
  }
  .kept,
  .sw.kept {
    background: var(--accent-fill);
    box-shadow: 0 0 24px -4px var(--accent-glow);
  }
  .future {
    background: linear-gradient(90deg, var(--accent-fill), transparent);
    opacity: 0.55;
  }
  .marker {
    position: absolute;
    top: 22px;
    bottom: 0;
    width: 0;
    border-left: 1.5px solid var(--text-3);
  }
  .marker span {
    position: absolute;
    bottom: 0;
    left: 0;
    transform: translateX(-50%);
    font-size: 11.5px;
    font-weight: 550;
    color: var(--text);
    white-space: nowrap;
    padding: 2px 8px;
    border-radius: 6px;
    background: var(--surface-2);
    border: 1px solid var(--line-2);
  }
  .marker.today span {
    transform: translateX(-80%);
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 20px;
    margin-top: 14px;
    font-size: var(--fs-xs);
    color: var(--text-3);
  }
  .legend span {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  .sw {
    display: inline-block;
    width: 14px;
    height: 10px;
    border-radius: 3px;
    box-shadow: 0 0 0 1px var(--line) inset;
  }
  @media (max-width: 560px) {
    .timeline {
      padding: 20px 16px 16px;
    }
    .in {
      display: none;
    }
  }
</style>

<script lang="ts">
  // The brand's signature: a line that runs past the 16-month horizon and ends in today's dot.
  // Left of the dashed horizon is history Search Console has dropped and Searchkeep kept.
  let { labels = true }: { labels?: boolean } = $props();

  const W = 1200;
  const H = 140;
  const HORIZON = 600;
  // A steady, slightly noisy climb: 31 points, 40 units apart.
  const ys = [
    118, 122, 112, 116, 106, 109, 100, 104, 95, 99, 88, 92, 84, 78, 82, 72, 76, 67, 70, 60, 64, 54, 58, 48, 52, 42, 45, 36, 38, 28, 22,
  ];
  const points = ys.map((y, i) => `${Math.min(i * 40, W - 20)},${y}`).join(' ');
  const last = { x: W - 20, y: ys.at(-1) ?? 0 };
</script>

<div class="horizon" class:quiet={!labels} aria-hidden="true">
  <svg viewBox="0 0 {W} {H}" preserveAspectRatio="none" fill="none">
    <line class="rule" x1="0" x2={W} y1={H - 0.5} y2={H - 0.5} />
    <line class="cut" x1={HORIZON} x2={HORIZON} y1="0" y2={H} />
    <polyline class="kept" {points} />
  </svg>
  <span class="today" style:left="{(last.x / W) * 100}%" style:top="{(last.y / H) * 100}%"></span>
  {#if labels}
    <span class="label left" style:right="{100 - (HORIZON / W) * 100}%">← kept by Searchkeep</span>
    <span class="label right" style:left="{(HORIZON / W) * 100}%">16-month window →</span>
  {/if}
</div>

<style>
  .horizon {
    position: relative;
    width: 100%;
    height: 140px;
  }
  .horizon.quiet {
    height: 110px;
    opacity: 0.7;
  }
  svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: visible;
  }
  .rule {
    stroke: var(--line-2);
    vector-effect: non-scaling-stroke;
  }
  .cut {
    stroke: var(--text-4);
    stroke-width: 1.25;
    stroke-dasharray: 3 5;
    vector-effect: non-scaling-stroke;
  }
  .kept {
    stroke: var(--text);
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
    vector-effect: non-scaling-stroke;
  }
  .today {
    position: absolute;
    width: 11px;
    height: 11px;
    border-radius: 50%;
    background: var(--signal);
    transform: translate(-50%, -50%);
  }
  .today::after {
    content: '';
    position: absolute;
    inset: -8px;
    border-radius: 50%;
    border: 1.5px solid var(--signal);
    opacity: 0.4;
  }
  @media (prefers-reduced-motion: no-preference) {
    .today::after {
      animation: ping 2.6s var(--ease) infinite;
    }
  }
  @keyframes ping {
    0% {
      transform: scale(0.6);
      opacity: 0.55;
    }
    80%,
    100% {
      transform: scale(1.6);
      opacity: 0;
    }
  }
  .label {
    position: absolute;
    top: -4px;
    padding-inline: 10px;
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 1;
    color: var(--text-3);
    white-space: nowrap;
  }
</style>

<script lang="ts">
  // The brand line (docs/brand): history running past the dashed 16-month horizon.
  // live: it ends in the Signal dot (today). paused: it stops at a hollow dot, nothing new is kept.
  interface Props {
    state?: 'live' | 'paused';
  }
  let { state = 'live' }: Props = $props();

  const kept = '0,46 32,49 64,41 96,44 128,36 160,39 192,31 224,34 256,27 288,30';
  const rest = '288,30 320,22 352,25 384,17 416,20 448,10';
</script>

<svg class="horizon" class:paused={state === 'paused'} viewBox="0 0 480 56" fill="none" aria-hidden="true">
  <line class="rule" x1="0" y1="55.5" x2="480" y2="55.5" />
  <line class="cut" x1="208" y1="0" x2="208" y2="56" />
  <polyline class="kept" points={kept} />
  <polyline class="rest" points={rest} />
  <circle class="end" cx="448" cy="10" r="4.5" />
</svg>

<style>
  .horizon {
    display: block;
    width: 100%;
    height: auto;
    overflow: visible;
  }
  .rule {
    stroke: var(--border-2);
  }
  .cut {
    stroke: var(--text-4);
    stroke-width: 1.25;
    stroke-dasharray: 3 5;
  }
  .kept,
  .rest {
    stroke: var(--text);
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .end {
    fill: var(--signal);
  }
  .paused .rest {
    stroke: var(--text-4);
    stroke-dasharray: 3 6;
  }
  .paused .end {
    fill: var(--surface);
    stroke: var(--text-4);
    stroke-width: 1.5;
  }
</style>

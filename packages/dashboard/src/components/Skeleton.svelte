<script lang="ts">
  interface Props {
    /** Preset shapes. */
    kind?: 'chart' | 'table' | 'stats' | 'block';
    rows?: number;
    height?: number;
  }
  let { kind = 'block', rows = 6, height = 200 }: Props = $props();
</script>

<div class="skeleton" aria-hidden="true">
  {#if kind === 'chart'}
    <div class="chart" style:height="{height}px">
      {#each [0.55, 0.7, 0.45, 0.8, 0.62, 0.9, 0.5, 0.75, 0.66, 0.85, 0.58, 0.72] as h, i (i)}
        <span class="skel" style:height="{h * 100}%"></span>
      {/each}
    </div>
  {:else if kind === 'table'}
    <span class="skel line head"></span>
    {#each Array(rows) as _, i (i)}
      <span class="skel line" style:width="{92 - ((i * 13) % 30)}%"></span>
    {/each}
  {:else if kind === 'stats'}
    <div class="stats">
      {#each Array(4) as _, i (i)}
        <div class="stat"><span class="skel s1"></span><span class="skel s2"></span><span class="skel s3"></span></div>
      {/each}
    </div>
  {:else}
    <span class="skel" style:height="{height}px"></span>
  {/if}
  <span class="sr-only">Loading</span>
</div>

<style>
  .skeleton {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .chart {
    display: flex;
    align-items: flex-end;
    gap: 6%;
    padding: 0 4px;
    opacity: 0.7;
  }
  .chart .skel {
    flex: 1;
    border-radius: 4px 4px 0 0;
  }
  .line {
    height: 14px;
  }
  .line.head {
    height: 10px;
    width: 40%;
    margin-bottom: 4px;
  }
  .stats {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 16px;
  }
  @media (max-width: 640px) {
    .stats {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  .stat {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .s1 {
    height: 10px;
    width: 50%;
  }
  .s2 {
    height: 24px;
    width: 70%;
  }
  .s3 {
    height: 10px;
    width: 35%;
  }
</style>

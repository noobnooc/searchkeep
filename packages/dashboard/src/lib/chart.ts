/** Small helpers for the hand-rolled SVG charts. */

/** Round axis ticks from 0 to at least `max`: 0, 500, 1,000, ... */
export function niceTicks(max: number, count = 4): number[] {
  if (!Number.isFinite(max) || max <= 0) return [0, 1];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  const ticks: number[] = [];
  for (let v = 0; v < max + step * 0.999; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  if (ticks.length < 2) ticks.push(step);
  return ticks;
}

/** Evenly spaced indices for x-axis labels that fit into `width` pixels. */
export function tickIndices(n: number, width: number, minGap = 84): number[] {
  if (n <= 0) return [];
  if (n === 1) return [0];
  const maxLabels = Math.max(2, Math.floor(width / minGap));
  const step = Math.max(1, Math.ceil((n - 1) / (maxLabels - 1)));
  const out: number[] = [];
  for (let i = 0; i < n; i += step) out.push(i);
  // Keep the last label unless it would collide with the previous one.
  const last = out[out.length - 1]!;
  if (last !== n - 1) {
    if (n - 1 - last >= step * 0.6) out.push(n - 1);
    else out[out.length - 1] = n - 1;
  }
  return out;
}

/** SVG path for a polyline that breaks at null values. */
export function linePath(points: Array<[number, number] | null>): string {
  let d = '';
  let pen = false;
  for (const p of points) {
    if (!p) {
      pen = false;
      continue;
    }
    d += `${pen ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`;
    pen = true;
  }
  return d;
}

/** Closed area paths under each unbroken run of points. */
export function areaPath(points: Array<[number, number] | null>, baseline: number): string {
  let d = '';
  let run: Array<[number, number]> = [];
  const flush = () => {
    if (run.length > 1) {
      d += `M${run[0]![0].toFixed(1)},${baseline}`;
      for (const [x, y] of run) d += `L${x.toFixed(1)},${y.toFixed(1)}`;
      d += `L${run[run.length - 1]![0].toFixed(1)},${baseline}Z`;
    }
    run = [];
  };
  for (const p of points) {
    if (p) run.push(p);
    else flush();
  }
  flush();
  return d;
}

/** A bar with 4px rounded top corners and a square base (`r` is clamped to fit). */
export function roundedTopBar(x: number, y: number, w: number, h: number, r = 4): string {
  if (h <= 0 || w <= 0) return '';
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

/** Approximate rendered width of a short label (axis sizing without measuring the DOM). */
export function textWidth(s: string, px = 11): number {
  return s.length * px * 0.58;
}

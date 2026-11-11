/** Number and date formatting. Dates are ISO calendar dates in UTC. */

export const MINUS = '−';
export const DASH = '—';

function signed(n: number, body: string): string {
  if (n > 0) return `+${body}`;
  if (n < 0) return `${MINUS}${body}`;
  return body;
}

/** 950 → "950", 1234 → "1.2k", 45_600 → "46k", 1_200_000 → "1.2M". */
export function compact(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return DASH;
  const a = Math.abs(n);
  const units: Array<[number, string]> = [
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'k'],
  ];
  for (let i = 0; i < units.length; i++) {
    const [d, suffix] = units[i]!;
    if (a >= d) {
      const v = a / d;
      let body = v < 10 ? v.toFixed(1).replace(/\.0$/, '') : String(Math.round(v));
      if (Number(body) >= 1000 && i > 0) {
        const [d2, s2] = units[i - 1]!;
        body = (a / d2).toFixed(1).replace(/\.0$/, '');
        return n < 0 ? `${MINUS}${body}${s2}` : `${body}${s2}`;
      }
      return n < 0 ? `${MINUS}${body}${suffix}` : `${body}${suffix}`;
    }
  }
  const body = Number.isInteger(a) ? String(a) : a.toFixed(1).replace(/\.0$/, '');
  return n < 0 ? `${MINUS}${body}` : body;
}

/** 12345 → "12,345". */
export function int(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return DASH;
  const body = Math.round(Math.abs(n)).toLocaleString('en-US');
  return n < 0 ? `${MINUS}${body}` : body;
}

/** Fixed decimals without trailing noise: 9.1 → "9.1". */
export function decimal(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return DASH;
  const body = Math.abs(n).toFixed(digits);
  return n < 0 ? `${MINUS}${body}` : body;
}

/** 1234.5, 'USD' → "$1,234.50"; `short`: "$1.2k", "$817", "$4.99". Unknown currency codes fall back to "1,234.50 XYZ". */
export function money(n: number | null | undefined, currency: string, short = false): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return DASH;
  const a = Math.abs(n);
  let body: string;
  try {
    const symbol = new Intl.NumberFormat('en-US', { style: 'currency', currency, currencyDisplay: 'narrowSymbol' })
      .formatToParts(0)
      .find((p) => p.type === 'currency')?.value;
    const digits = short ? (a >= 1000 ? undefined : a >= 100 ? 0 : 2) : 2;
    const amount =
      digits === undefined ? compact(a) : a.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
    body = symbol && symbol !== currency ? `${symbol}${amount}` : `${amount} ${currency}`;
  } catch {
    body = `${a.toFixed(2)} ${currency}`;
  }
  return n < 0 ? `${MINUS}${body}` : body;
}

/** 84 → "1m 24s", 3700 → "1h 1m", 12 → "12s". */
export function duration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return DASH;
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

/** Ratio 0..1 → "2.4%" (two decimals below 1%). */
export function percent(ratio: number | null | undefined, digits?: number): string {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return DASH;
  const p = ratio * 100;
  const d = digits ?? (Math.abs(p) > 0 && Math.abs(p) < 1 ? 2 : 1);
  return `${p.toFixed(d)}%`;
}

/** Percent value (already ×100, e.g. −5.7) → "−5.7%". */
export function pctChange(p: number | null | undefined): string {
  if (p === null || p === undefined || !Number.isFinite(p)) return DASH;
  const body = Math.abs(p).toFixed(Math.abs(p) >= 100 ? 0 : 1);
  return Number(body) === 0 ? `${body}%` : signed(p, `${body}%`);
}

/** Signed compact delta: +1.2k, −34. */
export function deltaCompact(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return DASH;
  return signed(n, compact(Math.abs(n)));
}

/** Signed decimal delta: +0.4, −1.2. */
export function deltaDecimal(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return DASH;
  const body = Math.abs(n).toFixed(digits);
  // No sign on values that round to zero ("0.0", never "−0.0").
  return Number(body) === 0 ? body : signed(n, body);
}

export function ms(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return DASH;
  return n >= 1000 ? `${(n / 1000).toFixed(2)} s` : `${Math.round(n)} ms`;
}

// ---- dates ---------------------------------------------------------------

export function parseDate(iso: string): Date {
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`);
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  return isoDate(new Date(parseDate(iso).getTime() + days * 86_400_000));
}

export function daysBetween(a: string, b: string): number {
  return Math.round((parseDate(b).getTime() - parseDate(a).getTime()) / 86_400_000);
}

export function eachDay(start: string, end: string): string[] {
  const out: string[] = [];
  const n = daysBetween(start, end);
  for (let i = 0; i <= n && i < 4000; i++) out.push(addDays(start, i));
  return out;
}

/** Monday of the ISO week. */
export function weekStart(iso: string): string {
  const d = parseDate(iso);
  const dow = (d.getUTCDay() + 6) % 7;
  return addDays(iso, -dow);
}

export function addYears(iso: string, years: number): string {
  const d = parseDate(iso);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return isoDate(d);
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function dtf(opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = JSON.stringify(opts);
  let f = fmtCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...opts });
    fmtCache.set(key, f);
  }
  return f;
}

/** "Oct 4" or "Oct 4, 2026". */
export function shortDate(iso: string | null | undefined, withYear = false): string {
  if (!iso) return DASH;
  return dtf(withYear ? { month: 'short', day: 'numeric', year: 'numeric' } : { month: 'short', day: 'numeric' }).format(parseDate(iso));
}

/** "Oct 2026" for month keys (YYYY-MM) or dates. */
export function monthLabel(isoOrMonth: string): string {
  const iso = isoOrMonth.length === 7 ? `${isoOrMonth}-01` : isoOrMonth;
  return dtf({ month: 'short', year: 'numeric' }).format(parseDate(iso));
}

/** "Oct 4 – 31, 2026", "Sep 6 – Oct 3, 2026", "Dec 1, 2025 – Jan 4, 2026". */
export function rangeLabel(r: { start: string; end: string } | null | undefined): string {
  if (!r) return '';
  const a = parseDate(r.start);
  const b = parseDate(r.end);
  const sameYear = a.getUTCFullYear() === b.getUTCFullYear();
  const sameMonth = sameYear && a.getUTCMonth() === b.getUTCMonth();
  if (r.start === r.end) return shortDate(r.start, true);
  if (sameMonth) return `${shortDate(r.start)} – ${b.getUTCDate()}, ${b.getUTCFullYear()}`;
  if (sameYear) return `${shortDate(r.start)} – ${shortDate(r.end, true)}`;
  return `${shortDate(r.start, true)} – ${shortDate(r.end, true)}`;
}

/** Timestamp → "Nov 3, 17:34 UTC". */
export function dateTime(ts: string | null | undefined): string {
  if (!ts) return DASH;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return `${dtf({ month: 'short', day: 'numeric' }).format(d)}, ${dtf({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d)} UTC`;
}

export function timeAgo(ts: string | null | undefined, now = Date.now()): string {
  if (!ts) return DASH;
  const t = new Date(ts).getTime();
  if (Number.isNaN(t)) return ts;
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h} h ago`;
  const d = Math.round(h / 24);
  return `${d} days ago`;
}

/** Human list: "a, b and c". */
export function list(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

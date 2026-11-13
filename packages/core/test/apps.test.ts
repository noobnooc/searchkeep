import { describe, expect, it } from 'vitest';
import {
  ASC_REPORTS,
  classifyPlayFile,
  DelimitedParser,
  loadConfig,
  normalizeAppSource,
  parseApps,
  readDelimited,
  validateApp,
  findApp,
  cellDate,
  playInstallsCollector,
  subscriptionMetricsCollector,
  type AppSubscriptionMetricWrite,
  type AppStoreWrite,
  type Store,
} from '../src/index.js';

const stream = (...chunks: Uint8Array[]) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      for (const x of chunks) c.enqueue(x);
      c.close();
    },
  });

async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  const out = new Response(
    stream(bytes).pipeThrough(new CompressionStream('gzip') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>),
  );
  return new Uint8Array(await out.arrayBuffer());
}

function utf16le(text: string): Uint8Array {
  const out = new Uint8Array(2 + text.length * 2);
  out[0] = 0xff;
  out[1] = 0xfe;
  for (let i = 0; i < text.length; i++) {
    out[2 + i * 2] = text.charCodeAt(i) & 0xff;
    out[3 + i * 2] = text.charCodeAt(i) >> 8;
  }
  return out;
}

describe('delimited reader', () => {
  it('parses tab separated text with normalized headers across chunk boundaries', () => {
    const rows: Array<Record<string, string>> = [];
    const p = new DelimitedParser((r) => rows.push(r));
    p.push('Date\tUnique  Counts\tTerri');
    p.push('tory\r\n2026-10-01\t5\tUS\r\n2026-10-02\t');
    p.push('7\tGB');
    expect(p.end()).toBe(2);
    expect(rows).toEqual([
      { date: '2026-10-01', 'unique counts': '5', territory: 'US' },
      { date: '2026-10-02', 'unique counts': '7', territory: 'GB' },
    ]);
  });

  it('keeps quoted commas, quotes and line breaks in CSV fields', () => {
    const rows: Array<Record<string, string>> = [];
    const p = new DelimitedParser((r) => rows.push(r));
    p.push('Star Rating,Review Text\n5,"Great, ""really""\ngreat"\n1,plain\n');
    p.end();
    expect(rows).toEqual([
      { 'star rating': '5', 'review text': 'Great, "really"\ngreat' },
      { 'star rating': '1', 'review text': 'plain' },
    ]);
  });

  it('reads gzip-compressed UTF-8 and UTF-16 files, split anywhere', async () => {
    const text = 'Date\tCounts\n2026-10-01\t3\n2026-10-02\t4\n';
    const gz = await gzip(new TextEncoder().encode(text));
    const rows: Array<Record<string, string>> = [];
    expect(await readDelimited(stream(gz.subarray(0, 5), gz.subarray(5)), (r) => rows.push(r))).toBe(2);
    expect(rows[1]).toEqual({ date: '2026-10-02', counts: '4' });

    const u16 = utf16le('Date,Country,Store listing visitors\n2026-10-01,DE,"1,234"\n');
    const got: Array<Record<string, string>> = [];
    // An odd split puts half of a UTF-16 code unit in each chunk.
    await readDelimited(stream(u16.subarray(0, 7), u16.subarray(7, 30), u16.subarray(30)), (r) => got.push(r));
    expect(got).toEqual([{ date: '2026-10-01', country: 'DE', 'store listing visitors': '1,234' }]);
  });

  it('reads report dates in the formats the stores use', () => {
    expect(cellDate('2026-03-30')).toBe('2026-03-30');
    expect(cellDate('20260330')).toBe('2026-03-30');
    expect(cellDate('3/30/2026')).toBe('2026-03-30');
    expect(cellDate('2026-03-30T10:00:00Z')).toBe('2026-03-30');
    expect(cellDate('nope')).toBeNull();
  });
});

describe('apps config', () => {
  it('validates and normalizes app definitions', () => {
    expect(
      validateApp({
        name: 'Acme App',
        appleId: 'https://apps.apple.com/us/app/acme/id1476097583',
        playPackage: 'https://play.google.com/store/apps/details?id=com.acme.app&hl=en',
        territories: 'US, gb',
      }),
    ).toEqual({
      app: { id: 'acme-app', name: 'Acme App', appleId: '1476097583', playPackage: 'com.acme.app', territories: ['us', 'gb'] },
    });
    expect(validateApp({ name: 'X' })).toEqual({ error: 'app needs an App Store Apple ID, a Google Play package name, or both.' });
    expect('error' in validateApp({ name: 'X', appleId: 'abc' })).toBe(true);
    expect('error' in validateApp({ name: 'X', playPackage: 'noperiod' })).toBe(true);
    expect('error' in validateApp({ name: 'X', appleId: '1234567', territories: ['us', 'gb', 'de', 'fr', 'jp', 'cn'] })).toBe(true);
  });

  it('reads APPS and the app credentials from secrets', () => {
    const errors: string[] = [];
    expect(parseApps('[{"name":"A","appleId":"123456"},{"name":"A","appleId":"654321"}]', errors)).toHaveLength(1);
    expect(errors).toEqual(['APPS[1].id "a" is duplicated.']);
    const cfg = loadConfig({
      APPS: '[{"id":"acme","name":"Acme","playPackage":"com.acme.app"}]',
      GSC_CLIENT_EMAIL: 'sa@x',
      GSC_PRIVATE_KEY: 'k',
      PLAY_REPORTS_BUCKET: 'gs://pubsite_prod_rev_0123/stats/installs/',
      ASC_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----',
    });
    expect(cfg.apps[0]).toMatchObject({ id: 'acme', origin: 'secret' });
    expect(cfg.play).toEqual({ clientEmail: 'sa@x', privateKey: 'k', bucket: 'pubsite_prod_rev_0123' });
    expect(cfg.asc.privateKey).toContain('\nabc\n');
    expect(cfg.appStorePublic).toBe(false);
    expect(findApp(cfg, 'com.acme.app').id).toBe('acme');
    expect(() => findApp(cfg, 'nope')).toThrow(/Unknown app/);
    expect(loadConfig({ PLAY_REPORTS_BUCKET: 'Bad Bucket!' }).errors).toEqual([expect.stringContaining('PLAY_REPORTS_BUCKET')]);
  });
});

describe('app report recognition', () => {
  it('maps store source types and recognizes report and file names', () => {
    expect(normalizeAppSource('App Store search')).toBe('search');
    expect(normalizeAppSource('Google Play explore')).toBe('browse');
    expect(normalizeAppSource('Third-party referrals')).toBe('referral');
    expect(normalizeAppSource('Something New')).toBe('something_new');
    const match = (name: string) => ASC_REPORTS.filter((r) => r.match(name)).map((r) => r.key);
    expect(match('App Store Discovery and Engagement Standard')).toEqual(['engagement']);
    expect(match('App Store Discovery and Engagement Detailed')).toEqual(['engagement_referrers']);
    expect(match('App Downloads Standard')).toEqual(['downloads']);
    expect(match('App Store Installation and Deletion Standard')).toEqual(['installs']);
    expect(match('App Crashes')).toEqual(['crashes']);
    expect(match('App Crashes Expanded')).toEqual([]);
    expect(match('App Store Purchases Standard')).toEqual(['purchases']);
    expect(match('App Store Subscription State Standard')).toEqual(['subscription_state']);
    expect(match('App Store Subscription Event Standard')).toEqual(['subscription_event']);
    expect(match('App Store Subscription Event Detailed')).toEqual([]);
    expect(match('Streaming Downloads Performance')).toEqual([]);
    expect(classifyPlayFile('stats/store_performance/store_performance_com.acme.app_202610_traffic_source.csv', 'com.acme.app')).toEqual({
      kind: 'store_traffic',
      month: '202610',
    });
    expect(classifyPlayFile('stats/ratings/ratings_com.acme.app_202610_overview.csv', 'com.acme.app')).toEqual({
      kind: 'ratings_overall',
      month: '202610',
    });
    expect(classifyPlayFile('stats/installs/installs_com.acme.app.pro_202610_country.csv', 'com.acme.app')).toBeNull();
    expect(classifyPlayFile('stats/installs/installs_com.acme.app_202610_device.csv', 'com.acme.app')).toEqual({
      kind: 'installs_breakdown',
      month: '202610',
      dimension: 'device',
    });
    expect(classifyPlayFile('stats/crashes/crashes_com.acme.app_202610_app_version.csv', 'com.acme.app')).toMatchObject({
      kind: 'crashes_breakdown',
      dimension: 'app_version',
    });
    expect(classifyPlayFile('stats/crashes/crashes_com.acme.app_202610_overview.csv', 'com.acme.app')).toBeNull();
    expect(classifyPlayFile('stats/installs/installs_com.acme.app_202610_carrier.csv', 'com.acme.app')).toBeNull();
  });
});

describe('Google Play installs files', () => {
  const read = async (rows: Array<Record<string, string>>) => {
    let written: AppStoreWrite | null = null;
    const store = {
      async writeAppStoreDaily(_app: string, _store: string, w: AppStoreWrite) {
        written = w;
        return w.rows.length;
      },
    } as unknown as Store;
    const c = playInstallsCollector();
    for (const r of rows) c.add(r);
    await c.write(store, 'app');
    return written!.rows.map((r) => [r.territory, r.installs, r.deletions, r.activeDevices]);
  };
  const row = (country: string, device: string, events: string) => ({
    date: '2026-10-05',
    country,
    'daily device installs': '3',
    'daily device uninstalls': device,
    'uninstall events': events,
    'active device installs': '40',
  });

  it('reads device uninstalls, or uninstall events when the device column stays 0 in the whole file', async () => {
    expect(await read([row('US', '0', '2'), row('IN', '0', '1')])).toEqual([
      ['US', 3, 2, 40],
      ['IN', 3, 1, 40],
    ]);
    // Device uninstalls reported somewhere in the file: that column is used for every row.
    expect(await read([row('US', '1', '2'), row('IN', '0', '1')])).toEqual([
      ['US', 3, 1, 40],
      ['IN', 3, 0, 40],
    ]);
    // Files without the events column keep working.
    expect(await read([{ date: '2026-10-05', country: 'US', 'daily device installs': '3', 'daily device uninstalls': '0' }])).toEqual([
      ['US', 3, 0, 0],
    ]);
  });
});

describe('Google Play financial files', () => {
  /** A minimal ZIP archive with one file, stored or deflated, optionally with a data descriptor. */
  async function zip(name: string, text: string, deflate: boolean, descriptor = false): Promise<Uint8Array> {
    const plain = new TextEncoder().encode(text);
    const data = deflate
      ? new Uint8Array(
          await new Response(
            stream(plain).pipeThrough(new CompressionStream('deflate-raw') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>),
          ).arrayBuffer(),
        )
      : plain;
    const nameBytes = new TextEncoder().encode(name);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(6, descriptor ? 8 : 0, true);
    local.setUint16(8, deflate ? 8 : 0, true);
    if (!descriptor) {
      local.setUint32(18, data.length, true);
      local.setUint32(22, plain.length, true);
    }
    local.setUint16(26, nameBytes.length, true);
    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(10, deflate ? 8 : 0, true);
    central.setUint32(20, data.length, true);
    central.setUint32(24, plain.length, true);
    central.setUint16(28, nameBytes.length, true);
    central.setUint32(42, 0, true);
    const trailer = descriptor ? new Uint8Array(16) : new Uint8Array(0);
    const centralAt = 30 + nameBytes.length + data.length + trailer.length;
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, 1, true);
    end.setUint16(10, 1, true);
    end.setUint32(12, 46 + nameBytes.length, true);
    end.setUint32(16, centralAt, true);
    const parts = [
      new Uint8Array(local.buffer),
      nameBytes,
      data,
      trailer,
      new Uint8Array(central.buffer),
      nameBytes,
      new Uint8Array(end.buffer),
    ];
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) {
      out.set(p, at);
      at += p.length;
    }
    return out;
  }

  it('reads the CSV inside a ZIP archive, stored or deflated, also with data descriptors', async () => {
    const csv = 'Transaction Date,Amount (Merchant Currency)\nOct 10, 2026,9.99\n';
    for (const [deflate, descriptor] of [
      [false, false],
      [true, false],
      [true, true],
    ] as const) {
      const rows: Array<Record<string, string>> = [];
      const bytes = await zip('earnings_202610.csv', csv.replace('Oct 10, 2026', '"Oct 10, 2026"'), deflate, descriptor);
      await readDelimited(stream(bytes.subarray(0, 7), bytes.subarray(7)), (r) => rows.push(r));
      expect(rows).toEqual([{ 'transaction date': 'Oct 10, 2026', 'amount (merchant currency)': '9.99' }]);
    }
    await expect(readDelimited(stream(await zip('notes.txt', 'x', false)), () => undefined)).rejects.toThrow(/no CSV file/);
  });

  it('reads month-name dates and recognizes subscription and earnings files', () => {
    expect(cellDate('Oct 10, 2026')).toBe('2026-10-10');
    expect(cellDate('Sept 3, 2026')).toBe('2026-09-03');
    expect(cellDate('Foo 3, 2026')).toBeNull();
    expect(
      classifyPlayFile('financial-stats/subscriptions/subscriptions_com.acme.app_pro_monthly_202610_country.csv', 'com.acme.app'),
    ).toEqual({
      kind: 'subscriptions',
      month: '202610',
      product: 'pro_monthly',
    });
    expect(classifyPlayFile('earnings/earnings_202610_1234567890-0.zip', 'com.acme.app')).toEqual({ kind: 'earnings', month: '202610' });
    expect(classifyPlayFile('sales/salesreport_202610.zip', 'com.acme.app')).toBeNull();
    // Another package's file (com.acme.app.pro) is not this package's.
    expect(
      classifyPlayFile('financial-stats/subscriptions/subscriptions_com.acme.app.pro_x_202610_country.csv', 'com.acme.app'),
    ).toBeNull();
  });
});

describe('App Store subscription reports', () => {
  /** A Subscription Event report (Standard) as Apple delivers it: tab separated, columns read by name. */
  const EVENT_TSV = [
    'Event Date\tApp Name\tApp Apple Identifier\tEvent Sub Type\tEvent Grouping\tSubscription Name\tSubscription Identifier\tSubscription Duration\tBilling Frequency\tBilling Period\tSubscription Group\tSubscription Group Identifier\tOffer Type\tOffer Name\tOffer ID\tVanity Code\tOffer Pricing\tOffer Duration\tPlan Change Type\tPrevious Subscription Name\tPrevious Subscription Identifier\tFamily Sharing\tCancellation Reason\tPaid Service Days Recovered\tApp Download Source Type\tPage Type\tPre-Order\tOriginal Purchase Device\tTerritory\tCounts',
    '2026-11-08\tEchobell\t6400000000\tFree Trial Starts\tOffer Starts\tPro Monthly\t6450000001\t1 Month\tMonthly\t\tPro\t21000000\tFree Trial\tLaunch\tL1\t\tFree\t1 Week\t\t\t\tIndividual\t\t\tApp Store search\tProduct page\tNo\tiPhone\tUS\t2',
    '2026-11-08\tEchobell\t6400000000\tFree Trial Starts\tOffer Starts\tPro Monthly\t6450000001\t1 Month\tMonthly\t\tPro\t21000000\tFree Trial\tLaunch\tL1\t\tFree\t1 Week\t\t\t\tIndividual\t\t\tApp Store search\tProduct page\tNo\tiPad\tUS\t1',
    '2026-11-08\tEchobell\t6400000000\tVoluntary Churn from Full Price\tVoluntary Churn\tPro Monthly\t6450000001\t1 Month\tMonthly\t\tPro\t21000000\t\t\t\t\t\t\t\t\t\tIndividual\tTurned off auto-renew\t\tUnavailable\tNo Page\tNo\tiPhone\tde\t1',
    '2026-11-09\tEchobell\t6400000000\tFull Price Renewals\tRenewals\tPro Annual\t6450000002\t1 Year\tYearly\t\tPro\t21000000\t\t\t\t\t\t\t\t\t\tShared with family\t\t\tInstitutional purchase\tProduct page\tNo\tMac\tJP\t0',
  ].join('\n');

  it('aggregates event rows per day, metric, subscription, offer, storefront and source, and replaces every covered day', async () => {
    const writes: AppSubscriptionMetricWrite[] = [];
    const store = {
      writeAppSubscriptionMetrics: async (_id: string, w: AppSubscriptionMetricWrite) => (writes.push(w), w.rows.length),
    } as unknown as Store;
    const c = subscriptionMetricsCollector('event');
    await readDelimited(stream(new TextEncoder().encode(EVENT_TSV)), (r) => c.add(r));
    const res = await c.write(store, 'echobell');
    expect(res).toEqual({ written: 2, oldest: '2026-11-08' });
    expect(writes[0]!.kind).toBe('event');
    // 2026-11-09 only had a zero row: still replaced, so older numbers for it go.
    expect(writes[0]!.dates).toEqual(['2026-11-08', '2026-11-09']);
    expect(writes[0]!.rows).toEqual([
      {
        date: '2026-11-08',
        metric: 'free_trial_starts',
        metricGroup: 'offer_starts',
        product: 'Pro Monthly',
        offerType: 'free_trial',
        territory: 'US',
        source: 'search',
        count: 3,
      },
      {
        date: '2026-11-08',
        metric: 'voluntary_churn_from_full_price',
        metricGroup: 'voluntary_churn',
        product: 'Pro Monthly',
        offerType: '',
        territory: 'DE',
        source: 'unavailable',
        count: 1,
      },
    ]);
  });

  it('keeps states without the download source, and only days before the snapshot limit', async () => {
    const tsv = [
      'Date\tApp Name\tApp Apple Identifier\tState Metric\tState Metric Grouping\tSubscription Name\tSubscription Identifier\tOffer Type\tAuto-Renew Status\tApp Download Source Type\tTerritory\tCounts',
      '2026-11-05\tEchobell\t6400000000\tFull price\tPaid plans\tPro Monthly\t6450000001\t\tAuto-renew on\tApp Store search\tUS\t7',
      '2026-11-05\tEchobell\t6400000000\tFull price\tPaid plans\tPro Monthly\t6450000001\t\tAuto-renew off\tWeb referrer\tUS\t2',
      '2026-11-06\tEchobell\t6400000000\tGrace period\tBilling issue\tPro Monthly\t6450000001\t\tAuto-renew on\tApp Store search\tUS\t1',
    ].join('\n');
    const writes: AppSubscriptionMetricWrite[] = [];
    const store = {
      writeAppSubscriptionMetrics: async (_id: string, w: AppSubscriptionMetricWrite) => (writes.push(w), w.rows.length),
    } as unknown as Store;
    const c = subscriptionMetricsCollector('state');
    await readDelimited(stream(new TextEncoder().encode(tsv)), (r) => c.add(r));
    await c.write(store, 'echobell', '2026-11-06');
    expect(writes[0]!.dates).toEqual(['2026-11-05']);
    expect(writes[0]!.rows).toEqual([
      {
        date: '2026-11-05',
        metric: 'full_price',
        metricGroup: 'paid_plans',
        product: 'Pro Monthly',
        offerType: '',
        territory: 'US',
        source: '*',
        count: 9,
      },
    ]);
  });
});

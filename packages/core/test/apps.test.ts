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
    expect(classifyPlayFile('stats/installs/installs_com.acme.app_202610_device.csv', 'com.acme.app')).toBeNull();
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

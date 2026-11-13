import { describe, expect, it } from 'vitest';
import { clearPlayTokenCache, createPlayClient, PLAY_SCOPES } from '../src/index.js';

async function pemKey() {
  const pair = (await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  const der = new Uint8Array((await crypto.subtle.exportKey('pkcs8', pair.privateKey)) as ArrayBuffer);
  let bin = '';
  for (const b of der) bin += String.fromCharCode(b);
  return `-----BEGIN PRIVATE KEY-----\n${btoa(bin)
    .match(/.{1,64}/g)!
    .join('\n')}\n-----END PRIVATE KEY-----\n`;
}

function utf16le(text: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(2 + text.length * 2);
  out[0] = 0xff;
  out[1] = 0xfe;
  for (let i = 0; i < text.length; i++) {
    out[2 + i * 2] = text.charCodeAt(i) & 0xff;
    out[3 + i * 2] = text.charCodeAt(i) >> 8;
  }
  return out;
}

describe('google play', () => {
  it('lists report files, reads a UTF-16 CSV and queries crash rates with read-only scopes', async () => {
    clearPlayTokenCache();
    const pk = await pemKey();
    const urls: string[] = [];
    let scope = '';
    const fetchMock = (async (url: string, init?: RequestInit) => {
      urls.push(url);
      if (url.includes('oauth2')) {
        const assertion = new URLSearchParams(String(init?.body)).get('assertion')!;
        scope = JSON.parse(atob(assertion.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/'))).scope;
        return Response.json({ access_token: 'tok', expires_in: 3600 });
      }
      expect((init?.headers as Record<string, string>).authorization).toBe('Bearer tok');
      if (url.includes('/o?')) {
        if (!url.includes('pageToken'))
          return Response.json({
            items: [{ name: 'stats/installs/installs_com.a_202610_country.csv', generation: '17', size: '20' }],
            nextPageToken: 'p2',
          });
        return Response.json({ items: [{ name: 'stats/installs/installs_com.a_202609_country.csv', generation: '9', size: '20' }] });
      }
      if (url.includes('alt=media'))
        return new Response(utf16le('Date,Package Name,Country,Daily Device Installs\n2026-10-01,com.a,US,5\n'));
      // The metric set's freshness: data is complete up to (not including) Oct 3.
      if (url.endsWith('/apps/com.a/crashRateMetricSet'))
        return Response.json({
          name: 'apps/com.a/crashRateMetricSet',
          freshnessInfo: {
            freshnesses: [
              { aggregationPeriod: 'DAILY', latestEndTime: { year: 2026, month: 10, day: 3, timeZone: { id: 'America/Los_Angeles' } } },
              { aggregationPeriod: 'HOURLY', latestEndTime: { year: 2026, month: 10, day: 4, hours: 5, timeZone: { id: 'UTC' } } },
            ],
          },
        });
      if (url.includes('crashRateMetricSet:query')) {
        const body = JSON.parse(String(init?.body));
        expect(body.timelineSpec).toEqual({
          aggregationPeriod: 'DAILY',
          startTime: { year: 2026, month: 10, day: 1, timeZone: { id: 'America/Los_Angeles' } },
          endTime: { year: 2026, month: 10, day: 3, timeZone: { id: 'America/Los_Angeles' } },
        });
        expect(body.dimensions).toEqual(['versionCode']);
        return Response.json({
          rows: [
            {
              aggregationPeriod: 'DAILY',
              startTime: { year: 2026, month: 10, day: 2, timeZone: { id: 'America/Los_Angeles' } },
              dimensions: [{ dimension: 'versionCode', int64Value: '31' }],
              metrics: [
                { metric: 'crashRate', decimalValue: { value: '0.0123' } },
                { metric: 'userPerceivedCrashRate', decimalValue: { value: '0.01' } },
                { metric: 'distinctUsers', decimalValue: { value: '412' } },
              ],
            },
          ],
        });
      }
      if (url.includes('apps:search'))
        return Response.json({ apps: [{ name: 'apps/com.a', packageName: 'com.a', displayLabel: 'A', displayName: 'A' }] });
      return new Response('{}', { status: 404 });
    }) as typeof fetch;
    const play = createPlayClient({ clientEmail: 'sa@p.iam.gserviceaccount.com', privateKey: pk, fetch: fetchMock });
    const objects = await play.listObjects('pubsite_prod_rev_1', 'stats/installs/installs_com.a_');
    expect(objects.map((o) => [o.name, o.generation])).toEqual([
      ['stats/installs/installs_com.a_202610_country.csv', '17'],
      ['stats/installs/installs_com.a_202609_country.csv', '9'],
    ]);
    expect(urls[1]).toContain('/b/pubsite_prod_rev_1/o?prefix=stats%2Finstalls%2Finstalls_com.a_');
    const rows: Array<Record<string, string>> = [];
    await play.readCsv('pubsite_prod_rev_1', 'stats/installs/installs_com.a_202610_country.csv', (r) => rows.push(r));
    expect(rows).toEqual([{ date: '2026-10-01', 'package name': 'com.a', country: 'US', 'daily device installs': '5' }]);
    expect(urls.find((u) => u.includes('alt=media'))).toContain('/o/stats%2Finstalls%2Finstalls_com.a_202610_country.csv?alt=media');
    // Asked up to Oct 5, but Google is complete only through Oct 2: the timeline ends there.
    expect(await play.vitals('com.a', 'crash', { start: '2026-10-01', end: '2026-10-05' })).toEqual([
      { date: '2026-10-02', version: '31', rate: 0.0123, userPerceivedRate: 0.01, distinctUsers: 412 },
    ]);
    // Nothing complete in the range: no query.
    const before = urls.length;
    expect(await play.vitals('com.a', 'crash', { start: '2026-10-03', end: '2026-10-05' })).toEqual([]);
    expect(urls.slice(before).some((u) => u.includes(':query'))).toBe(false);
    expect(await play.listApps()).toEqual([{ packageName: 'com.a', name: 'A' }]);
    expect(scope).toBe(PLAY_SCOPES);
    expect(urls.filter((u) => u.includes('oauth2'))).toHaveLength(1);
  });

  it('reports a file it cannot read by name and status', async () => {
    clearPlayTokenCache();
    const pk = await pemKey();
    const fetchMock = (async (url: string) =>
      url.includes('oauth2')
        ? Response.json({ access_token: 'tok', expires_in: 3600 })
        : new Response('denied', { status: 403 })) as typeof fetch;
    const play = createPlayClient({ clientEmail: 'sa@x', privateKey: pk, fetch: fetchMock });
    await expect(play.readCsv('b', 'reviews/reviews_com.a_202610.csv', () => {})).rejects.toThrow(
      'play: could not read reviews/reviews_com.a_202610.csv (HTTP 403)',
    );
  });

  it('checks whether a file may be read by fetching its first byte', async () => {
    clearPlayTokenCache();
    const pk = await pemKey();
    const seen: Array<{ url: string; range: string | null }> = [];
    const fetchMock = (async (url: string, init?: RequestInit) => {
      if (url.includes('oauth2')) return Response.json({ access_token: 'tok', expires_in: 3600 });
      seen.push({ url, range: new Headers(init?.headers).get('range') });
      if (url.includes('earnings')) return new Response('denied', { status: 403 });
      if (url.includes('missing')) return new Response('gone', { status: 404 });
      return new Response('P', { status: 206 });
    }) as typeof fetch;
    const play = createPlayClient({ clientEmail: 'sa@x', privateKey: pk, fetch: fetchMock });
    expect(await play.canRead('b', 'financial-stats/subscriptions/subscriptions_com.a_m_202610_country.csv')).toBe(true);
    expect(await play.canRead('b', 'earnings/earnings_202610_1-0.zip')).toBe(false);
    await expect(play.canRead('b', 'missing.csv')).rejects.toThrow('play: could not read missing.csv (HTTP 404)');
    expect(seen.every((s) => s.range === 'bytes=0-0' && s.url.endsWith('?alt=media'))).toBe(true);
  });

  it('reads listings and tracks through an edit it deletes, never commits, and asks for the publisher scope only when on', async () => {
    clearPlayTokenCache();
    const pk = await pemKey();
    const seen: string[] = [];
    let scope = '';
    let failTracks = false;
    const fetchMock = (async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      seen.push(`${method} ${url.replace('https://androidpublisher.googleapis.com/androidpublisher/v3/applications', '')}`);
      if (url.includes('oauth2')) {
        const assertion = new URLSearchParams(String(init?.body)).get('assertion')!;
        scope = JSON.parse(atob(assertion.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/'))).scope;
        return Response.json({ access_token: 'tok', expires_in: 3600 });
      }
      if (method === 'POST' && url.endsWith('/edits')) return Response.json({ id: 'e1', expiryTimeSeconds: '1800000000' });
      if (url.endsWith('/edits/e1/listings'))
        return Response.json({
          kind: 'androidpublisher#listingsListResponse',
          listings: [{ language: 'en-US', title: 'Echobell', shortDescription: 'Alerts that ring', fullDescription: 'Long text' }],
        });
      if (url.endsWith('/edits/e1/tracks')) {
        if (failTracks) return Response.json({ error: { code: 500, message: 'boom' } }, { status: 500 });
        return Response.json({
          tracks: [
            {
              track: 'production',
              releases: [
                {
                  name: '2.4.0',
                  versionCodes: ['125'],
                  status: 'inProgress',
                  userFraction: 0.2,
                  releaseNotes: [{ language: 'en-US', text: 'Faster alerts' }],
                },
                { name: '2.3.0', versionCodes: ['123'], status: 'completed' },
              ],
            },
          ],
        });
      }
      if (method === 'DELETE') return new Response(null, { status: 204 });
      return new Response('not found', { status: 404 });
    }) as typeof fetch;
    const off = createPlayClient({ clientEmail: 'sa@x.iam.gserviceaccount.com', privateKey: pk, fetch: fetchMock });
    expect(off.listingSnapshot).toBeUndefined();
    const play = createPlayClient({ clientEmail: 'sa@x.iam.gserviceaccount.com', privateKey: pk, publisher: true, fetch: fetchMock });
    const snap = await play.listingSnapshot!('one.echobell.app');
    expect(scope.split(' ')).toContain('https://www.googleapis.com/auth/androidpublisher');
    expect(snap.scopes).toEqual(['listing', 'track']);
    expect(snap.values).toEqual([
      { entity: 'listing', locale: 'en-US', field: 'title', value: 'Echobell' },
      { entity: 'listing', locale: 'en-US', field: 'short_description', value: 'Alerts that ring' },
      { entity: 'listing', locale: 'en-US', field: 'full_description', value: 'Long text' },
      { entity: 'track:production', locale: '', field: 'releases', value: '2.4.0 [125] inProgress 20%; 2.3.0 [123] completed' },
      { entity: 'track:production', locale: 'en-US', field: 'release_notes', value: 'Faster alerts' },
    ]);
    expect(seen.filter((x) => !x.includes('oauth2'))).toEqual([
      'POST /one.echobell.app/edits',
      'GET /one.echobell.app/edits/e1/listings',
      'GET /one.echobell.app/edits/e1/tracks',
      'DELETE /one.echobell.app/edits/e1',
    ]);
    expect(seen.some((x) => x.includes(':commit'))).toBe(false);
    // The edit is deleted also when reading fails.
    failTracks = true;
    seen.length = 0;
    await expect(play.listingSnapshot!('one.echobell.app')).rejects.toThrow();
    expect(seen.at(-1)).toBe('DELETE /one.echobell.app/edits/e1');
  });

  it('reads the last week of reviews without author names and replies only when asked', async () => {
    clearPlayTokenCache();
    const pk = await pemKey();
    const seen: Array<{ url: string; method: string; body: string | null }> = [];
    const fetchMock = (async (url: string, init?: RequestInit) => {
      if (url.includes('oauth2')) return Response.json({ access_token: 'tok', expires_in: 3600 });
      seen.push({ url, method: init?.method ?? 'GET', body: init?.body ? String(init.body) : null });
      if (url.includes('/reviews?'))
        return Response.json({
          reviews: [
            {
              reviewId: 'gp:AOq1',
              authorName: 'Jane Doe',
              comments: [
                {
                  userComment: {
                    text: 'Love the alerts',
                    lastModified: { seconds: '1793000000', nanos: 0 },
                    starRating: 5,
                    reviewerLanguage: 'en',
                    appVersionName: '2.4.0',
                  },
                },
                { developerComment: { text: 'Thanks!', lastModified: { seconds: '1793000100' } } },
              ],
            },
          ],
          tokenPagination: { nextPageToken: 'n2' },
        });
      if (url.includes(':reply')) return Response.json({ result: { replyText: 'Thanks', lastEdited: { seconds: '1793000200' } } });
      return new Response('{}', { status: 404 });
    }) as typeof fetch;
    expect(createPlayClient({ clientEmail: 'sa@x', privateKey: pk, publisher: true, fetch: fetchMock }).listReviews).toBeUndefined();
    const play = createPlayClient({ clientEmail: 'sa@x', privateKey: pk, publisher: true, reviews: true, fetch: fetchMock });
    const page = await play.listReviews!('one.echobell.app');
    expect(page).toEqual({
      reviews: [
        {
          id: 'gp:AOq1',
          modifiedAt: new Date(1793000000 * 1000).toISOString(),
          rating: 5,
          text: 'Love the alerts',
          language: 'en',
          version: '2.4.0',
          replied: true,
        },
      ],
      next: 'n2',
    });
    expect(JSON.stringify(page)).not.toContain('Jane');
    expect(seen.every((x) => x.method === 'GET')).toBe(true);
    await play.replyToReview!('one.echobell.app', 'gp:AOq1', 'Thanks');
    expect(seen.at(-1)).toEqual({
      url: 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications/one.echobell.app/reviews/gp%3AAOq1:reply',
      method: 'POST',
      body: JSON.stringify({ replyText: 'Thanks' }),
    });
  });
});

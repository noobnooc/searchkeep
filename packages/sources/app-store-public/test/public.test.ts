import { describe, expect, it } from 'vitest';
import { createAppStorePublicClient } from '../src/index.js';

describe('app store public feeds', () => {
  it('reads the rating of one app and chart positions from the official feeds', async () => {
    const urls: string[] = [];
    const fetchMock = (async (url: string) => {
      urls.push(url);
      if (url.startsWith('https://itunes.apple.com/lookup'))
        return Response.json({
          resultCount: 1,
          results: [{ trackName: 'Acme', averageUserRating: 4.52, userRatingCount: 2900, version: '5.0', primaryGenreId: 6007 }],
        });
      if (url.startsWith('https://rss.marketingtools.apple.com/'))
        return Response.json({ feed: { results: [{ id: '11' }, { id: '22' }] } });
      if (url.includes('/rss/topfreeapplications/limit=100/genre=6007/json'))
        return Response.json({ feed: { entry: [{ id: { attributes: { 'im:id': '33' } } }, { id: { attributes: { 'im:id': '22' } } }] } });
      if (url.includes('/rss/topgrossingapplications/limit=100/json'))
        return Response.json({ feed: { entry: { id: { attributes: { 'im:id': '44' } } } } });
      return new Response('{}', { status: 404 });
    }) as typeof fetch;
    const pub = createAppStorePublicClient({ fetch: fetchMock });
    expect(await pub.lookup('22', 'US')).toEqual({
      appleId: '22',
      name: 'Acme',
      averageUserRating: 4.52,
      userRatingCount: 2900,
      version: '5.0',
      primaryGenreId: '6007',
    });
    expect(urls[0]).toBe('https://itunes.apple.com/lookup?id=22&country=us&entity=software');
    expect(await pub.topChart('us', 'top-free')).toEqual(['11', '22']);
    expect(urls[1]).toBe('https://rss.marketingtools.apple.com/api/v2/us/apps/top-free/100/apps.json');
    expect(await pub.topChart('us', 'top-free', '6007')).toEqual(['33', '22']);
    expect(await pub.topChart('us', 'top-grossing')).toEqual(['44']);
    await expect(pub.topChart('usa', 'top-free')).rejects.toThrow(/invalid storefront/);
  });

  it('switches to the fallback transport when Apple refuses the IP (HTTP 403), and stays on it', async () => {
    let direct = 0;
    let fallback = 0;
    let switched = 0;
    const pub = createAppStorePublicClient({
      fetch: (async () => {
        direct++;
        return new Response('Forbidden', { status: 403 });
      }) as typeof fetch,
      fallbackFetch: (async (url: string) => {
        fallback++;
        return String(url).includes('/lookup')
          ? Response.json({ results: [{ trackName: 'Acme', averageUserRating: 4.5, userRatingCount: 10, primaryGenreId: 6007 }] })
          : Response.json({ feed: { results: [{ id: '22' }] } });
      }) as typeof fetch,
      onFallback: () => switched++,
    });
    expect(await pub.lookup('22', 'us')).toMatchObject({ averageUserRating: 4.5, primaryGenreId: '6007' });
    expect(await pub.topChart('us', 'top-free')).toEqual(['22']);
    expect({ direct, fallback, switched }).toEqual({ direct: 1, fallback: 2, switched: 1 });
  });

  it('keeps other errors, and a 403 without a fallback, as they are', async () => {
    let fallback = 0;
    const fallbackFetch = (async () => {
      fallback++;
      return Response.json({ results: [] });
    }) as typeof fetch;
    const notFound = createAppStorePublicClient({
      fetch: (async () => new Response('nope', { status: 404 })) as typeof fetch,
      fallbackFetch,
    });
    await expect(notFound.lookup('22', 'us')).rejects.toThrow('HTTP 404');
    const noFallback = createAppStorePublicClient({ fetch: (async () => new Response('Forbidden', { status: 403 })) as typeof fetch });
    await expect(noFallback.lookup('22', 'us')).rejects.toThrow('HTTP 403');
    expect(fallback).toBe(0);
  });

  it('reads a chart from the older feed when the current one times out, and each chart once per client', async () => {
    const urls: string[] = [];
    const fetchMock = (async (url: string) => {
      urls.push(url);
      if (url === 'https://rss.marketingtools.apple.com/api/v2/cn/apps/top-paid/100/apps.json')
        return new Response('<html>Gateway Timeout</html>', { status: 504 });
      if (url.startsWith('https://rss.marketingtools.apple.com/')) return Response.json({ feed: { results: [{ id: '11' }] } });
      if (url === 'https://itunes.apple.com/cn/rss/toppaidapplications/limit=100/json')
        return Response.json({ feed: { entry: [{ id: { attributes: { 'im:id': '55' } } }] } });
      return new Response('{}', { status: 404 });
    }) as typeof fetch;
    const pub = createAppStorePublicClient({ fetch: fetchMock });
    expect(await pub.topChart('cn', 'top-paid')).toEqual(['55']);
    // Tried once (no retry), then the older feed.
    expect(urls).toEqual([
      'https://rss.marketingtools.apple.com/api/v2/cn/apps/top-paid/100/apps.json',
      'https://itunes.apple.com/cn/rss/toppaidapplications/limit=100/json',
    ]);
    expect(await pub.topChart('CN', 'top-paid')).toEqual(['55']);
    expect(await pub.topChart('cn', 'top-free')).toEqual(['11']);
    expect(await pub.topChart('cn', 'top-free')).toEqual(['11']);
    expect(urls).toHaveLength(3);
    // A client error is not a timeout: no fallback, and a failed chart is not kept.
    await expect(pub.topChart('cn', 'top-free', '6002')).rejects.toThrow(/404/);
    await expect(pub.topChart('cn', 'top-free', '6002')).rejects.toThrow(/404/);
    expect(urls.filter((u) => u.includes('genre=6002'))).toHaveLength(2);
  });
});

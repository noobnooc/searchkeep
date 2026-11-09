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
});

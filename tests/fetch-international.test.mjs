import { describe, it, expect } from 'vitest';
import { fetchInternational } from '../scripts/fetch-international.mjs';

describe('fetchInternational', () => {
  function makeBuf(xml) { return new TextEncoder().encode(xml).buffer; }
  const now = new Date();
  const recent = now.toUTCString();

  const worldXml = `<?xml version="1.0"?><rss version="2.0"><channel>
    <item><title>NATO allies push back at US threat to Spain</title>
      <link>https://x/iw0</link><description>European leaders reject pressure.</description>
      <pubDate>${recent}</pubDate></item>
    <item><title>Argentina's central bank ends crawling peg</title>
      <link>https://x/iw1</link><description>FX reserves at 3-year low.</description>
      <pubDate>${recent}</pubDate></item>
  </channel></rss>`;

  const travelXml = `<?xml version="1.0"?><rss version="2.0"><channel>
    <item><title>The 25 best new hotels in the world for 2026</title>
      <link>https://x/it0</link><description>Annual ranking.</description>
      <pubDate>${recent}</pubDate></item>
    <item><title>Looser, longer, easier: relaxed tailoring</title>
      <link>https://x/it1</link><description>Fall trend.</description>
      <pubDate>${recent}</pubDate></item>
  </channel></rss>`;

  function fakeFetchByUrl(url) {
    const xml = url.includes('world') ? worldXml : travelXml;
    return Promise.resolve({ ok: true, arrayBuffer: async () => makeBuf(xml) });
  }

  it('returns world and travelStyle pools tagged region=international', async () => {
    const out = await fetchInternational({
      fetchImpl: fakeFetchByUrl,
      now,
      worldFeeds: [{ url: 'https://world.test/rss', source: 'BBC News', weight: 10 }],
      travelStyleFeeds: [{ url: 'https://travel.test/rss', source: 'CN Traveler', kind: 'travel', weight: 11 }],
    });
    expect(out.world.length).toBe(2);
    expect(out.travelStyle.length).toBe(2);
    expect(out.world.every(s => s.region === 'international')).toBe(true);
    expect(out.travelStyle.every(s => s.region === 'international')).toBe(true);
    expect(out.world.every(s => s.bias === null)).toBe(true);
  });

  it('tags travelStyle items with kind from feed', async () => {
    const out = await fetchInternational({
      fetchImpl: fakeFetchByUrl,
      now,
      worldFeeds: [],
      travelStyleFeeds: [
        { url: 'https://t1.test/rss', source: 'CN Traveler', kind: 'travel', weight: 11 },
        { url: 'https://t2.test/rss', source: 'GQ',          kind: 'style',  weight: 9  },
      ],
    });
    const kinds = new Set(out.travelStyle.map(s => s.kind));
    expect(kinds.has('travel')).toBe(true);
    expect(kinds.has('style')).toBe(true);
  });

  it('continues when one feed errors', async () => {
    let call = 0;
    const fakeFetch = async (url) => {
      call++;
      if (call === 1) return { ok: false, status: 503, statusText: 'down' };
      return { ok: true, arrayBuffer: async () => makeBuf(worldXml) };
    };
    const out = await fetchInternational({
      fetchImpl: fakeFetch,
      now,
      worldFeeds: [
        { url: 'https://broken.test/rss', source: 'Broken', weight: 5 },
        { url: 'https://ok.test/rss',     source: 'BBC',    weight: 10 },
      ],
      travelStyleFeeds: [],
    });
    expect(out.world.length).toBe(2);
  });

  it('skips items older than the world cutoff (36h)', async () => {
    const xml = `<?xml version="1.0"?><rss version="2.0"><channel>
      <item><title>Old story</title><link>https://x/old</link>
        <description>Too old.</description><pubDate>Sun, 01 Jan 2020 00:00:00 GMT</pubDate></item>
      <item><title>Fresh story</title><link>https://x/fresh</link>
        <description>Recent.</description><pubDate>${recent}</pubDate></item>
    </channel></rss>`;
    const fakeFetch = async () => ({ ok: true, arrayBuffer: async () => makeBuf(xml) });
    const out = await fetchInternational({
      fetchImpl: fakeFetch, now,
      worldFeeds: [{ url: 'https://x.test/rss', source: 'X', weight: 5 }],
      travelStyleFeeds: [],
    });
    expect(out.world.length).toBe(1);
    expect(out.world[0].title).toBe('Fresh story');
  });
});

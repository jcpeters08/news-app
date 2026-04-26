import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchGenAI, parseFeed, hasKeyword, pickTopGenAI, tipScore, decodeHtmlEntities } from '../scripts/fetch-genai.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function loadFixture(name, now) {
  const raw = await fs.readFile(path.join(__dirname, 'fixtures', name), 'utf8');
  return raw.replaceAll('REPLACE_NOW', now.toUTCString());
}

describe('parseFeed', () => {
  it('parses RSS 2.0', async () => {
    const xml = await loadFixture('rss-anthropic.xml', new Date());
    const items = parseFeed(xml);
    expect(items.length).toBe(2);
    expect(items[0].title).toContain('Claude Opus');
    expect(items[0].url).toContain('anthropic.com');
    expect(items[0].publishedAt).toBeTruthy();
  });

  it('parses Atom', async () => {
    const xml = await loadFixture('rss-simon.xml', new Date());
    const items = parseFeed(xml);
    expect(items.length).toBe(1);
    expect(items[0].title).toContain('Claude prompting');
    expect(items[0].url).toContain('simonwillison.net');
  });
});

describe('hasKeyword', () => {
  it('matches genai keywords case-insensitively', () => {
    expect(hasKeyword('A new Claude release')).toBe(true);
    expect(hasKeyword('OpenAI announces something')).toBe(true);
    expect(hasKeyword('Stock market news')).toBe(false);
  });
});

describe('fetchGenAI (mocked)', () => {
  it('aggregates and scores items', async () => {
    const now = new Date();
    const anthropicXml = await loadFixture('rss-anthropic.xml', now);
    const simonXml = await loadFixture('rss-simon.xml', now);

    const fakeFetch = async (url) => ({
      ok: true,
      text: async () => url.includes('anthropic') ? anthropicXml : simonXml,
    });

    const feeds = [
      { url: 'https://anthropic.test/rss', source: 'Anthropic', weight: 10 },
      { url: 'https://simon.test/atom', source: 'Simon Willison', weight: 9 },
    ];
    const items = await fetchGenAI({ fetchImpl: fakeFetch, now, feeds });
    expect(items.length).toBe(3);
    // Anthropic items should outrank Simon (higher weight + same recency).
    expect(items[0].source).toBe('Anthropic');
  });

  it('filters by keyword when filterKeywords is true', async () => {
    const now = new Date();
    const xml = `<?xml version="1.0"?><rss version="2.0"><channel>
      <item><title>Cooking pasta tips</title><link>https://x.test/1</link><pubDate>${now.toUTCString()}</pubDate></item>
      <item><title>Claude release notes</title><link>https://x.test/2</link><pubDate>${now.toUTCString()}</pubDate></item>
    </channel></rss>`;
    const fakeFetch = async () => ({ ok: true, text: async () => xml });
    const items = await fetchGenAI({
      fetchImpl: fakeFetch, now,
      feeds: [{ url: 'https://hn.test/rss', source: 'HN', weight: 5, filterKeywords: true }],
    });
    expect(items.length).toBe(1);
    expect(items[0].title).toContain('Claude');
  });
});

describe('tipScore', () => {
  it('boosts tutorial/how-to language', () => {
    expect(tipScore('How to use Claude for code review')).toBeGreaterThan(0);
    expect(tipScore('A tutorial on prompt engineering')).toBeGreaterThan(0);
  });
  it('de-ranks pure announcement language', () => {
    expect(tipScore('Introducing GPT-5.5')).toBeLessThan(0);
    expect(tipScore('Now available: Claude Opus')).toBeLessThan(0);
  });
  it('returns 0 for neutral text', () => {
    expect(tipScore('Stock market news today')).toBe(0);
  });
});

describe('fetchGenAI ranks tip content above announcements', () => {
  it('a tip post outranks an announcement when same weight & recency', async () => {
    const now = new Date();
    const xml = `<?xml version="1.0"?><rss version="2.0"><channel>
      <item><title>Introducing GPT-5.5</title><description>Now available.</description><link>https://x/announce</link><pubDate>${now.toUTCString()}</pubDate></item>
      <item><title>How to use Claude for advanced code review</title><description>Tutorial on prompting.</description><link>https://x/tip</link><pubDate>${now.toUTCString()}</pubDate></item>
    </channel></rss>`;
    const fakeFetch = async () => ({ ok: true, text: async () => xml });
    const items = await fetchGenAI({
      fetchImpl: fakeFetch, now,
      feeds: [{ url: 'https://x.test/rss', source: 'Mixed', weight: 5 }],
    });
    expect(items[0].url).toBe('https://x/tip');
  });
});

describe('decodeHtmlEntities', () => {
  it('decodes numeric decimal entities (&#8217;)', () => {
    expect(decodeHtmlEntities('Mexico&#8217;s week in review')).toBe('Mexico’s week in review');
  });
  it('decodes &amp;', () => {
    expect(decodeHtmlEntities('AT&amp;T')).toBe('AT&T');
  });
  it('decodes hex numeric entities (&#x27;)', () => {
    expect(decodeHtmlEntities('it&#x27;s')).toBe("it's");
  });
  it('decodes &nbsp; to a space', () => {
    expect(decodeHtmlEntities('a&nbsp;b')).toBe('a b');
  });
  it('decodes &lt;', () => {
    expect(decodeHtmlEntities('1 &lt; 2')).toBe('1 < 2');
  });
  it('leaves entity-free strings unchanged', () => {
    expect(decodeHtmlEntities('plain text, no entities')).toBe('plain text, no entities');
  });
  it('decoded titles flow through parseFeed', () => {
    const xml = `<?xml version="1.0"?><rss version="2.0"><channel>
      <item><title>Mexico&amp;#8217;s week</title><link>https://x/1</link><pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate></item>
    </channel></rss>`;
    const items = parseFeed(xml);
    expect(items[0].title).toBe('Mexico’s week');
  });
});

describe('pickTopGenAI', () => {
  it('dedupes by URL and limits count', () => {
    const items = [
      { url: 'a', title: '1', _score: 100 },
      { url: 'a', title: '1-dup', _score: 90 },
      { url: 'b', title: '2', _score: 80 },
      { url: 'c', title: '3', _score: 70 },
    ];
    const top = pickTopGenAI(items, 2);
    expect(top.length).toBe(2);
    expect(top.map(i => i.url)).toEqual(['a', 'b']);
    expect(top[0]._score).toBeUndefined();
  });
});

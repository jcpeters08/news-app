import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchGenAI, parseFeed, hasKeyword, pickTopGenAI } from '../scripts/fetch-genai.mjs';

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

import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  fetchCategory, transformStories, normalizeTitle, pickTop,
} from '../scripts/fetch-news.mjs';
import { SOURCE_BIAS } from '../scripts/sources.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function loadFixture(name, now) {
  const raw = await fs.readFile(path.join(__dirname, 'fixtures', name), 'utf8');
  return JSON.parse(raw.replaceAll('REPLACE_NOW', now.toISOString()));
}

describe('normalizeTitle', () => {
  it('lowercases and strips punctuation', () => {
    expect(normalizeTitle('Hello, World! 2026')).toBe('hello world 2026');
  });
  it('treats near-duplicates the same', () => {
    expect(normalizeTitle('Climate ruling reshapes federal authority'))
      .toBe(normalizeTitle('CLIMATE RULING reshapes federal authority!'));
  });
});

describe('transformStories', () => {
  it('attaches bias rating when source is known', async () => {
    const now = new Date();
    const fx = await loadFixture('newsapi-politics.json', now);
    const stories = transformStories(fx.articles, 'politics', now);
    const reuters = stories.find(s => s.sourceId === 'reuters');
    expect(reuters.bias).toBe(SOURCE_BIAS.reuters);
    expect(reuters.biasLabel).toBe('Center');
  });

  it('dedupes by normalized title', async () => {
    const now = new Date();
    const fx = await loadFixture('newsapi-politics.json', now);
    const stories = transformStories(fx.articles, 'politics', now);
    const climate = stories.filter(s => s.title.toLowerCase().includes('climate ruling'));
    expect(climate.length).toBe(1);
  });

  it('filters out stories older than 36h', async () => {
    const now = new Date();
    const fx = await loadFixture('newsapi-politics.json', now);
    const stories = transformStories(fx.articles, 'politics', now);
    expect(stories.find(s => s.title.includes('Old story'))).toBeUndefined();
  });

  it('skips articles with missing title/url/source', () => {
    const now = new Date();
    const stories = transformStories([
      { source: null, title: 'no source', url: 'x', publishedAt: now.toISOString() },
      { source: { id: 'reuters', name: 'r' }, title: '', url: 'x', publishedAt: now.toISOString() },
      { source: { id: 'reuters', name: 'r' }, title: 't', url: '', publishedAt: now.toISOString() },
    ], 'politics', now);
    expect(stories).toEqual([]);
  });
});

describe('pickTop with balance', () => {
  it('prefers a mix across the bias spectrum', async () => {
    const now = new Date();
    const fx = await loadFixture('newsapi-politics.json', now);
    const stories = transformStories(fx.articles, 'politics', now);
    const top = pickTop(stories, 5, { balance: true });
    const biases = new Set(top.map(s => s.bias));
    // Should include at least 3 different lean buckets given the fixture mix.
    expect(biases.size).toBeGreaterThanOrEqual(3);
  });
});

describe('fetchCategory (mocked fetch)', () => {
  it('throws on missing API key', async () => {
    await expect(fetchCategory({ category: 'politics', apiKey: '' }))
      .rejects.toThrow(/NEWSAPI_KEY/);
  });

  it('politics hits top-headlines with sources and no category param', async () => {
    const now = new Date();
    const fx = await loadFixture('newsapi-politics.json', now);
    let calledUrl;
    const fakeFetch = async (url) => {
      calledUrl = url;
      return { ok: true, json: async () => fx };
    };
    const stories = await fetchCategory({
      category: 'politics', apiKey: 'fake', fetchImpl: fakeFetch, now,
    });
    expect(calledUrl).toContain('newsapi.org/v2/top-headlines');
    expect(calledUrl).toContain('apiKey=fake');
    expect(calledUrl).toContain('sources=');
    // Critical: NewsAPI rejects sources+category combo with 400.
    expect(calledUrl).not.toContain('category=');
    expect(stories.length).toBeGreaterThan(0);
  });

  it('medicine_tech uses everything endpoint with topic query', async () => {
    const now = new Date();
    let calledUrl;
    const fakeFetch = async (url) => {
      calledUrl = url;
      return { ok: true, json: async () => ({ status: 'ok', articles: [] }) };
    };
    await fetchCategory({
      category: 'medicine_tech', apiKey: 'fake', fetchImpl: fakeFetch, now,
    });
    expect(calledUrl).toContain('newsapi.org/v2/everything');
    expect(calledUrl).toContain('sortBy=publishedAt');
    expect(calledUrl).toMatch(/q=.*technology/i);
    expect(calledUrl).toContain('from=');
  });

  it('throws on non-200', async () => {
    const fakeFetch = async () => ({ ok: false, status: 429, statusText: 'Too Many Requests' });
    await expect(fetchCategory({ category: 'politics', apiKey: 'k', fetchImpl: fakeFetch }))
      .rejects.toThrow(/429/);
  });
});

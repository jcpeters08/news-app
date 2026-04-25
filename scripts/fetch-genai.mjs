import { XMLParser } from 'fast-xml-parser';
import { GENAI_FEEDS, GENAI_KEYWORDS } from './sources.js';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
});

export async function fetchGenAI({ fetchImpl = fetch, now = new Date(), feeds = GENAI_FEEDS } = {}) {
  const cutoff = now.getTime() - 7 * 24 * 3600 * 1000; // last week
  const all = [];

  for (const feed of feeds) {
    try {
      const res = await fetchImpl(feed.url, { headers: { 'User-Agent': 'news-app/0.1' } });
      if (!res.ok) {
        console.error(`Feed ${feed.source} failed: ${res.status}`);
        continue;
      }
      const xml = await res.text();
      const items = parseFeed(xml).map(item => ({
        ...item,
        source: feed.source,
        weight: feed.weight,
        filterKeywords: !!feed.filterKeywords,
      }));
      all.push(...items);
    } catch (e) {
      console.error(`Feed ${feed.source} error:`, e.message);
    }
  }

  return all
    .filter(i => i.publishedAt && new Date(i.publishedAt).getTime() >= cutoff)
    .filter(i => !i.filterKeywords || hasKeyword(i.title + ' ' + (i.description || '')))
    .map(i => ({
      title: i.title,
      url: i.url,
      source: i.source,
      publishedAt: i.publishedAt,
      description: stripHtml(i.description || '').slice(0, 240),
      category: 'genai',
      _score: scoreItem(i, now),
    }))
    .sort((a, b) => b._score - a._score);
}

export function parseFeed(xml) {
  const obj = parser.parse(xml);
  const items = [];

  // RSS 2.0
  const rssItems = obj?.rss?.channel?.item;
  if (rssItems) {
    const arr = Array.isArray(rssItems) ? rssItems : [rssItems];
    for (const it of arr) {
      items.push({
        title: cleanText(it.title),
        url: typeof it.link === 'string' ? it.link : (it.link?.['#text'] || it.guid),
        publishedAt: parseDate(it.pubDate || it['dc:date']),
        description: cleanText(it.description || it['content:encoded']),
      });
    }
    return items;
  }

  // Atom
  const atomEntries = obj?.feed?.entry;
  if (atomEntries) {
    const arr = Array.isArray(atomEntries) ? atomEntries : [atomEntries];
    for (const it of arr) {
      const link = Array.isArray(it.link)
        ? (it.link.find(l => l['@_rel'] === 'alternate' || !l['@_rel'])?.['@_href'])
        : it.link?.['@_href'];
      items.push({
        title: cleanText(typeof it.title === 'string' ? it.title : it.title?.['#text']),
        url: link,
        publishedAt: parseDate(it.published || it.updated),
        description: cleanText(typeof it.summary === 'string' ? it.summary : it.summary?.['#text'] || it.content?.['#text']),
      });
    }
  }
  return items;
}

function parseDate(d) {
  if (!d) return null;
  const t = new Date(d);
  return Number.isFinite(t.getTime()) ? t.toISOString() : null;
}

function cleanText(s) {
  if (!s) return '';
  if (typeof s !== 'string') s = String(s);
  return s.trim();
}

function stripHtml(s) {
  return s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

export function hasKeyword(text) {
  const lower = text.toLowerCase();
  return GENAI_KEYWORDS.some(k => lower.includes(k));
}

function scoreItem(item, now) {
  // weight + recency boost
  const ageHours = (now.getTime() - new Date(item.publishedAt).getTime()) / (3600 * 1000);
  const recency = Math.max(0, 100 - ageHours); // newer = higher
  return item.weight * 10 + recency;
}

export function pickTopGenAI(items, n) {
  // Dedupe by URL.
  const seen = new Set();
  const out = [];
  for (const i of items) {
    if (!i.url || seen.has(i.url)) continue;
    seen.add(i.url);
    const { _score, ...rest } = i;
    out.push(rest);
    if (out.length >= n) break;
  }
  return out;
}

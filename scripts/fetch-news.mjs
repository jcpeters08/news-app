import { SOURCE_BIAS, BIAS_LABEL, POLITICS_SOURCES, TECH_MED_SOURCES } from './sources.js';

const NEWSAPI = 'https://newsapi.org/v2/top-headlines';
const PAGE_SIZE = 30;

export async function fetchCategory({ category, apiKey, fetchImpl = fetch, now = new Date() }) {
  if (!apiKey) throw new Error('NEWSAPI_KEY missing');

  const sources = category === 'politics' ? POLITICS_SOURCES : TECH_MED_SOURCES;
  const url = new URL(NEWSAPI);
  url.searchParams.set('sources', sources.join(','));
  url.searchParams.set('pageSize', String(PAGE_SIZE));
  if (category === 'politics') url.searchParams.set('category', 'general');
  url.searchParams.set('apiKey', apiKey);

  const res = await fetchImpl(url.toString());
  if (!res.ok) {
    throw new Error(`NewsAPI ${category} failed: ${res.status} ${res.statusText}`);
  }
  const json = await res.json();
  if (json.status !== 'ok') {
    throw new Error(`NewsAPI ${category} status: ${json.status} - ${json.message || ''}`);
  }
  return transformStories(json.articles || [], category, now);
}

export function transformStories(articles, category, now = new Date()) {
  const cutoff = now.getTime() - 36 * 3600 * 1000; // last 36h only
  const seen = new Set();
  const stories = [];

  for (const a of articles) {
    if (!a?.title || !a.url || !a.source?.id) continue;
    const ts = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
    if (!Number.isFinite(ts) || ts < cutoff) continue;

    const dedupKey = normalizeTitle(a.title);
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);

    const bias = SOURCE_BIAS[a.source.id] ?? null;
    stories.push({
      title: a.title,
      url: a.url,
      source: a.source.name || a.source.id,
      sourceId: a.source.id,
      bias,
      biasLabel: bias ? BIAS_LABEL[bias] : null,
      publishedAt: a.publishedAt,
      description: a.description || '',
      category,
    });
  }

  return stories;
}

export function normalizeTitle(t) {
  return t.toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

// Pick top N with diversity across the bias spectrum (politics) or top recent (tech/med).
export function pickTop(stories, n, { balance = false } = {}) {
  if (!balance) {
    return [...stories]
      .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
      .slice(0, n);
  }
  // For politics: try to surface mix across left/center/right.
  const buckets = { left: [], 'lean-left': [], center: [], 'lean-right': [], right: [], unknown: [] };
  for (const s of stories) buckets[s.bias || 'unknown'].push(s);
  for (const k of Object.keys(buckets)) {
    buckets[k].sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  }
  // Round-robin pick across spectrum prioritizing center, then lean, then extremes.
  const order = ['center', 'lean-left', 'lean-right', 'left', 'right', 'unknown'];
  const out = [];
  let progressed = true;
  while (out.length < n && progressed) {
    progressed = false;
    for (const k of order) {
      if (out.length >= n) break;
      if (buckets[k].length) {
        out.push(buckets[k].shift());
        progressed = true;
      }
    }
  }
  return out;
}

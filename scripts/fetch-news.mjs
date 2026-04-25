import { SOURCE_BIAS, BIAS_LABEL, POLITICS_SOURCES, TECH_MED_SOURCES } from './sources.js';

const TOP_HEADLINES = 'https://newsapi.org/v2/top-headlines';
const EVERYTHING = 'https://newsapi.org/v2/everything';
const PAGE_SIZE = 50;

// NewsAPI quirk: top-headlines accepts `sources` OR (`category`+`country`),
// not both. We use top-headlines+sources for politics (broad daily news),
// and `everything`+keyword query for medicine/tech (topic-targeted).
export async function fetchCategory({ category, apiKey, fetchImpl = fetch, now = new Date() }) {
  if (!apiKey) throw new Error('NEWSAPI_KEY missing');
  const url = category === 'politics'
    ? buildPoliticsUrl(apiKey)
    : buildMedTechUrl(apiKey, now);

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

function buildPoliticsUrl(apiKey) {
  const url = new URL(TOP_HEADLINES);
  url.searchParams.set('sources', POLITICS_SOURCES.join(','));
  url.searchParams.set('pageSize', String(PAGE_SIZE));
  url.searchParams.set('apiKey', apiKey);
  return url;
}

function buildMedTechUrl(apiKey, now) {
  const url = new URL(EVERYTHING);
  url.searchParams.set('sources', TECH_MED_SOURCES.join(','));
  // Boolean OR query targeting medicine, tech, science, AI topics.
  url.searchParams.set('q',
    '(technology OR AI OR "artificial intelligence" OR medicine OR health OR science OR research OR biotech)');
  url.searchParams.set('language', 'en');
  url.searchParams.set('sortBy', 'publishedAt');
  url.searchParams.set('pageSize', String(PAGE_SIZE));
  // Last 36h, matches transform filter.
  const from = new Date(now.getTime() - 36 * 3600 * 1000).toISOString();
  url.searchParams.set('from', from);
  url.searchParams.set('apiKey', apiKey);
  return url;
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

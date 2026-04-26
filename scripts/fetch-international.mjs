// International news + travel/style RSS aggregator. Returns two pools so
// the curator can bucket world stories into politics vs general news, and
// travel/style stories straight into the third International column.

import { parseFeed } from './fetch-genai.mjs';
import { fetchFeedXml } from './fetch-mexico.mjs';
import { INTL_WORLD_FEEDS, INTL_TRAVEL_STYLE_FEEDS } from './sources.js';

export async function fetchInternational({
  fetchImpl = fetch,
  now = new Date(),
  worldFeeds = INTL_WORLD_FEEDS,
  travelStyleFeeds = INTL_TRAVEL_STYLE_FEEDS,
} = {}) {
  const [world, travelStyle] = await Promise.all([
    fetchPool(worldFeeds, fetchImpl, now, 36 * 3600 * 1000, 'international'),
    fetchPool(travelStyleFeeds, fetchImpl, now, 7 * 24 * 3600 * 1000, 'international', { tagKind: true }),
  ]);
  return { world, travelStyle };
}

async function fetchPool(feeds, fetchImpl, now, windowMs, region, { tagKind = false } = {}) {
  const cutoff = now.getTime() - windowMs;
  const all = [];
  for (const feed of feeds) {
    try {
      const xml = await fetchFeedXml(feed.url, fetchImpl);
      const items = parseFeed(xml).map(item => ({
        ...item,
        source: feed.source,
        weight: feed.weight,
        kind: tagKind ? feed.kind : undefined,
      }));
      all.push(...items);
    } catch (e) {
      console.error(`Intl feed ${feed.source} error:`, e.message);
    }
  }
  return all
    .filter(i => i.publishedAt && new Date(i.publishedAt).getTime() >= cutoff)
    .map(i => ({
      title: i.title,
      url: i.url,
      source: i.source,
      sourceId: null,
      bias: null,
      biasLabel: null,
      region,
      kind: i.kind,
      publishedAt: i.publishedAt,
      description: clean(i.description).slice(0, 360),
      _score: scoreItem(i, now),
    }))
    .sort((a, b) => b._score - a._score);
}

function scoreItem(item, now) {
  const ageHours = (now.getTime() - new Date(item.publishedAt).getTime()) / 3600000;
  const recency = Math.max(0, 100 - ageHours);
  return (item.weight || 5) * 10 + recency;
}

function clean(s) {
  if (!s) return '';
  return String(s).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

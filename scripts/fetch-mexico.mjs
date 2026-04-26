// Mexico-focused RSS aggregator. Reuses parseFeed from fetch-genai.
// Adds encoding detection so feeds declared as iso-8859-1 (e.g., Reforma)
// don't come back as mojibake.

import { parseFeed } from './fetch-genai.mjs';
import { MEXICO_FEEDS } from './sources.js';

export async function fetchMexico({
  fetchImpl = fetch,
  now = new Date(),
  feeds = MEXICO_FEEDS,
  maxItems = 30,
} = {}) {
  const cutoff = now.getTime() - 36 * 3600 * 1000; // 36h window, same as politics
  const all = [];

  for (const feed of feeds) {
    try {
      const xml = await fetchFeedXml(feed.url, fetchImpl);
      const items = parseFeed(xml).map(item => ({
        ...item,
        source: feed.source,
        language: feed.language,
        weight: feed.weight,
        oaxaca: !!feed.oaxaca,
      }));
      all.push(...items);
    } catch (e) {
      console.error(`Mexico feed ${feed.source} error:`, e.message);
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
      region: 'mexico',
      language: i.language,
      isOaxaca: i.oaxaca || mentionsOaxaca(i.title + ' ' + (i.description || '')),
      publishedAt: i.publishedAt,
      description: cleanText(i.description).slice(0, 360),
      category: 'politics',
      _score: scoreItem(i, now),
    }))
    .sort((a, b) => b._score - a._score)
    .slice(0, maxItems);
}

// Encoding-aware fetch: peek at the XML declaration in the first ~200 bytes
// and decode accordingly. UTF-8 default; latin1 fallback for legacy feeds.
export async function fetchFeedXml(url, fetchImpl) {
  const res = await fetchImpl(url, { headers: { 'User-Agent': 'news-app/0.1' } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const buf = await res.arrayBuffer();
  const head = new TextDecoder('latin1').decode(buf.slice(0, 256));
  const m = /encoding\s*=\s*["']([^"']+)["']/i.exec(head);
  const declared = (m?.[1] || 'utf-8').toLowerCase();
  // Map common aliases the platform's TextDecoder accepts.
  const enc = (declared === 'iso-8859-1' || declared === 'latin1' || declared === 'iso8859-1')
    ? 'iso-8859-1'
    : declared;
  try {
    return new TextDecoder(enc).decode(buf);
  } catch {
    // Unknown label — fall back to utf-8.
    return new TextDecoder('utf-8').decode(buf);
  }
}

const OAXACA_RE = /\b(oaxaca|puerto\s*escondido|huatulco|mazunte|zipolite|pochutla|costa\s*chica|istmo)\b/i;
function mentionsOaxaca(text) { return OAXACA_RE.test(text); }

function scoreItem(item, now) {
  const ageHours = (now.getTime() - new Date(item.publishedAt).getTime()) / 3600000;
  const recency = Math.max(0, 100 - ageHours);
  const oaxacaBoost = item.oaxaca ? 80
    : (mentionsOaxaca(item.title + ' ' + (item.description || '')) ? 50 : 0);
  return (item.weight || 5) * 10 + recency + oaxacaBoost;
}

function cleanText(s) {
  if (!s) return '';
  return String(s).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

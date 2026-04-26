// Claude-powered news curator. One API call picks the top N per category,
// writes a 1–2 sentence "why it matters" gloss per story, and generates a
// 2–3 sentence daily brief. Falls back gracefully if the API key is missing
// or the call fails.

import Anthropic from '@anthropic-ai/sdk';
import { USER_PREFS_TEXT } from './prefs.js';

export const DEFAULT_MODEL = process.env.CLAUDE_MODEL || 'claude-opus-4-5';

export function isAvailable(env = process.env) {
  return !!env.ANTHROPIC_API_KEY;
}

// Public entry: takes raw candidate arrays, returns enriched picks + brief.
// On any failure, returns { ok: false, error } so the caller can fall back.
export async function curateAll({
  politics, medicineTech, genai,
  n = 5,
  model = DEFAULT_MODEL,
  client,                 // injectable for tests
  env = process.env,
} = {}) {
  if (!client) {
    if (!isAvailable(env)) return { ok: false, error: 'ANTHROPIC_API_KEY missing' };
    client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  }

  const candidates = {
    politics: tagIds(politics, 'p'),
    medicineTech: tagIds(medicineTech, 'm'),
    genai: tagIds(genai, 'g'),
  };

  const prompt = buildPrompt(candidates, n);

  try {
    const resp = await client.messages.create({
      model,
      max_tokens: 2000,
      system: USER_PREFS_TEXT.trim() + '\n\n' + outputSpec(n),
      messages: [
        { role: 'user', content: prompt },
        // Prefill `{` to force JSON output.
        { role: 'assistant', content: '{' },
      ],
    });

    const raw = '{' + extractText(resp);
    const parsed = parseJson(raw);
    const result = applyPicks(candidates, parsed, n);
    return {
      ok: true,
      ...result,
      tokens: resp.usage,
      model: resp.model,
    };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

// ---- helpers ----

function tagIds(items, prefix) {
  return (items || []).map((s, i) => ({ ...s, _id: `${prefix}_${i}` }));
}

function summarize(s) {
  // Compact representation Claude can scan quickly.
  const desc = (s.description || '').slice(0, 240).replace(/\s+/g, ' ').trim();
  const bias = s.biasLabel ? ` [${s.biasLabel}]` : '';
  const when = s.publishedAt ? ` (${relAge(s.publishedAt)})` : '';
  return `${s._id}: [${s.source}${bias}${when}] ${s.title}${desc ? ' — ' + desc : ''}`;
}

function relAge(iso) {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const hrs = Math.max(0, Math.round((Date.now() - t) / 3600000));
  return hrs < 1 ? 'just now' : hrs < 24 ? `${hrs}h ago` : `${Math.round(hrs / 24)}d ago`;
}

export function buildPrompt(candidates, n) {
  const sec = (label, list) => list.length
    ? `\n${label} candidates (${list.length}):\n${list.map(summarize).join('\n')}`
    : `\n${label} candidates: (none)`;
  return [
    `Pick the ${n} most relevant items per category from the candidates below,`,
    `following the priorities and exclusions in the system prompt. Then write`,
    `a daily brief.`,
    sec('POLITICS', candidates.politics),
    sec('MEDICINE_TECH', candidates.medicineTech),
    sec('GENAI', candidates.genai),
  ].join('\n');
}

function outputSpec(n) {
  return `OUTPUT FORMAT — return ONLY a single JSON object, no prose, no markdown:
{
  "politics":     [{"id": "p_X", "whyItMatters": "..."}, ... up to ${n} items],
  "medicineTech": [{"id": "m_X", "whyItMatters": "..."}, ... up to ${n} items],
  "genai":        [{"id": "g_X", "whyItMatters": "..."}, ... up to ${n} items],
  "dailyBrief":   "2–3 sentence brief in plain prose"
}
Use the EXACT ids from the candidate list. If fewer than ${n} candidates qualify
under the priorities/exclusions, return fewer rather than padding with weak
items. Never invent ids.`;
}

function extractText(resp) {
  // Anthropic SDK returns content blocks; concat any text blocks.
  const blocks = resp?.content || [];
  return blocks.filter(b => b.type === 'text').map(b => b.text).join('');
}

export function parseJson(raw) {
  // Tolerate trailing prose after the JSON object.
  const start = raw.indexOf('{');
  if (start < 0) throw new Error('No JSON object in response');
  // Find the matching closing brace by depth.
  let depth = 0;
  for (let i = start; i < raw.length; i++) {
    const c = raw[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return JSON.parse(raw.slice(start, i + 1));
    }
  }
  throw new Error('Unbalanced JSON in response');
}

export function applyPicks(candidates, parsed, n) {
  const byId = {};
  for (const k of ['politics', 'medicineTech', 'genai']) {
    for (const s of candidates[k]) byId[s._id] = s;
  }
  const pick = (key) => (parsed[key] || []).slice(0, n).map(p => {
    const src = byId[p.id];
    if (!src) return null;
    const { _id, ...rest } = src;
    return { ...rest, whyItMatters: cleanGloss(p.whyItMatters) };
  }).filter(Boolean);
  return {
    politics: pick('politics'),
    medicineTech: pick('medicineTech'),
    genai: pick('genai'),
    dailyBrief: typeof parsed.dailyBrief === 'string' ? parsed.dailyBrief.trim() : '',
  };
}

function cleanGloss(s) {
  if (!s) return '';
  return String(s).replace(/\s+/g, ' ').trim().slice(0, 320);
}

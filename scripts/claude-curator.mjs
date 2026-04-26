// Claude-powered news curator. One API call buckets candidates from each
// pool into the dashboard's tabbed layout (US / Mexico×3 / International×3),
// plus the always-on Med/Tech and GenAI strips, and writes the daily brief.
// Falls back gracefully if the API key is missing or the call fails.

import Anthropic from '@anthropic-ai/sdk';
import { USER_PREFS_TEXT } from './prefs.js';

export const DEFAULT_MODEL = process.env.CLAUDE_MODEL || 'claude-opus-4-5';

export function isAvailable(env = process.env) {
  return !!env.ANTHROPIC_API_KEY;
}

// Public entry. Takes a `candidates` object with one array per pool;
// returns a structured result mirroring the dashboard layout.
// On failure: { ok: false, error }. Caller falls back.
export async function curateAll({
  candidates,             // { usPolitics, mexico, intlWorld, intlTravelStyle, medicineTech, genai }
  n = 5,
  model = DEFAULT_MODEL,
  client,                 // injectable for tests
  env = process.env,
} = {}) {
  if (!client) {
    if (!isAvailable(env)) return { ok: false, error: 'ANTHROPIC_API_KEY missing' };
    client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  }

  const tagged = {
    usPolitics:       tagIds(candidates?.usPolitics,       'us'),
    mexico:           tagIds(candidates?.mexico,           'mx'),
    intlWorld:        tagIds(candidates?.intlWorld,        'iw'),
    intlTravelStyle:  tagIds(candidates?.intlTravelStyle,  'it'),
    medicineTech:     tagIds(candidates?.medicineTech,     'm'),
    genai:            tagIds(candidates?.genai,            'g'),
  };

  const prompt = buildPrompt(tagged, n);

  try {
    const resp = await client.messages.create({
      model,
      max_tokens: 4000,
      system: USER_PREFS_TEXT.trim() + '\n\n' + outputSpec(n),
      messages: [
        { role: 'user', content: prompt },
        { role: 'assistant', content: '{' },
      ],
    });

    const raw = '{' + extractText(resp);
    const parsed = parseJson(raw);
    const result = applyPicks(tagged, parsed, n);
    return { ok: true, ...result, tokens: resp.usage, model: resp.model };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

function tagIds(items, prefix) {
  return (items || []).map((s, i) => ({ ...s, _id: `${prefix}_${i}` }));
}

function summarize(s) {
  const desc = (s.description || '').slice(0, 220).replace(/\s+/g, ' ').trim();
  const bias = s.biasLabel ? ` [${s.biasLabel}]` : (s.region === 'mexico' ? ' [MX]' : '');
  const lang = s.language && s.language !== 'en' ? ` (${s.language})` : '';
  const kind = s.kind ? ` <${s.kind}>` : '';
  const oaxaca = s.isOaxaca ? ' ★Oaxaca' : '';
  const when = s.publishedAt ? ` (${relAge(s.publishedAt)})` : '';
  return `${s._id}: [${s.source}${bias}${lang}${kind}${oaxaca}${when}] ${s.title}${desc ? ' — ' + desc : ''}`;
}

function relAge(iso) {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const hrs = Math.max(0, Math.round((Date.now() - t) / 3600000));
  return hrs < 1 ? 'just now' : hrs < 24 ? `${hrs}h ago` : `${Math.round(hrs / 24)}d ago`;
}

export function buildPrompt(tagged, n) {
  const sec = (label, list) => list.length
    ? `\n\n${label} candidates (${list.length}):\n${list.map(summarize).join('\n')}`
    : `\n\n${label} candidates: (none)`;

  return [
    `Bucket the candidates into the layout below, picking up to ${n} per bucket.`,
    `Follow the priorities, exclusions, and bucketing rules in the system prompt.`,
    `Then write a daily brief.`,
    sec('US POLITICS pool',                       tagged.usPolitics),
    sec('MEXICO pool (split into politics / culture / oaxacaCoast)', tagged.mexico),
    sec('INTERNATIONAL WORLD pool (split into politics / generalNews)', tagged.intlWorld),
    sec('INTERNATIONAL TRAVEL & STYLE pool',      tagged.intlTravelStyle),
    sec('MEDICINE & TECH pool',                   tagged.medicineTech),
    sec('GENAI pool',                             tagged.genai),
  ].join('');
}

function outputSpec(n) {
  return `OUTPUT FORMAT — return ONLY a single JSON object, no prose, no markdown:
{
  "us": {
    "politics":     [{"id":"us_X","whyItMatters":"..."}, ... up to ${n}]
  },
  "mexico": {
    "politics":     [{"id":"mx_X","whyItMatters":"..."}, ... up to ${n}],
    "culture":      [{"id":"mx_X","whyItMatters":"..."}, ... up to ${n}],
    "oaxacaCoast":  [{"id":"mx_X","whyItMatters":"..."}, ... up to ${n}]
  },
  "international": {
    "politics":     [{"id":"iw_X","whyItMatters":"..."}, ... up to ${n}],
    "generalNews":  [{"id":"iw_X","whyItMatters":"..."}, ... up to ${n}],
    "travelStyle":  [{"id":"it_X","whyItMatters":"..."}, ... up to ${n}]
  },
  "medicineTech":   [{"id":"m_X","whyItMatters":"..."}, ... up to ${n}],
  "genai":          [{"id":"g_X","whyItMatters":"..."}, ... up to ${n}],
  "dailyBrief":     "2–3 sentence brief in plain prose"
}

BUCKETING RULES:
- mexico.oaxacaCoast: stories about Puerto Escondido, Huatulco, Mazunte,
  Zipolite, Pochutla, Costa Chica, Istmo de Tehuantepec, or items from the
  ★Oaxaca-flagged feed. Always prefer these here over national or culture.
- mexico.politics: Mexican government, security, economy, Mexico–US
  relations, infrastructure, national-level news.
- mexico.culture: food, music, art, festivals, travel inside Mexico,
  lifestyle, design — stories you'd point a friend visiting Mexico to.
- international.politics: foreign government, elections, diplomacy,
  conflict, geopolitical analysis (non-US, non-Mexico).
- international.generalNews: world stories that aren't politics — science,
  environment, society, business, culture if global.
- international.travelStyle: pick across travel, fashion, design.
- A single Mexico candidate must appear in at most ONE Mexico bucket.
- A single international-world candidate must appear in at most ONE bucket.
- If fewer than ${n} candidates qualify for a bucket, return fewer rather
  than padding with weak items. Never invent ids.

Use the EXACT ids from the candidate lists.`;
}

function extractText(resp) {
  return (resp?.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
}

export function parseJson(raw) {
  const start = raw.indexOf('{');
  if (start < 0) throw new Error('No JSON object in response');
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

export function applyPicks(tagged, parsed, n) {
  const byId = {};
  for (const k of Object.keys(tagged)) {
    for (const s of tagged[k]) byId[s._id] = s;
  }
  const pickList = (arr) => (arr || []).slice(0, n).map(p => {
    const src = byId[p.id];
    if (!src) return null;
    const { _id, _score, ...rest } = src;
    return { ...rest, whyItMatters: cleanGloss(p.whyItMatters) };
  }).filter(Boolean);

  return {
    us: {
      politics:    pickList(parsed?.us?.politics),
    },
    mexico: {
      politics:    pickList(parsed?.mexico?.politics),
      culture:     pickList(parsed?.mexico?.culture),
      oaxacaCoast: pickList(parsed?.mexico?.oaxacaCoast),
    },
    international: {
      politics:    pickList(parsed?.international?.politics),
      generalNews: pickList(parsed?.international?.generalNews),
      travelStyle: pickList(parsed?.international?.travelStyle),
    },
    medicineTech:  pickList(parsed?.medicineTech),
    genai:         pickList(parsed?.genai),
    dailyBrief:    typeof parsed?.dailyBrief === 'string' ? parsed.dailyBrief.trim() : '',
  };
}

function cleanGloss(s) {
  if (!s) return '';
  return String(s).replace(/\s+/g, ' ').trim().slice(0, 320);
}

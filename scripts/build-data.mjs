// Orchestrator: gates on exact local time (America/Chicago 6am or 1pm),
// fetches all candidate pools in parallel, hands them to Claude for
// bucketing into the tabbed layout, writes public/data.json. On total
// failure the existing data.json is preserved.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchCategory, pickTop } from './fetch-news.mjs';
import { fetchGenAI, pickTopGenAI } from './fetch-genai.mjs';
import { fetchMexico } from './fetch-mexico.mjs';
import { fetchInternational } from './fetch-international.mjs';
import { fetchWeather, CITIES } from './fetch-weather.mjs';
import { curateAll, isAvailable as claudeAvailable } from './claude-curator.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA_PATH = path.join(ROOT, 'public', 'data.json');

const STORIES_PER_BUCKET = 5;
// Per-pool candidate counts handed to Claude. Tuned to keep input ≲ 12K tokens.
const POOL = {
  usPolitics:      20,
  mexico:          25, // Mexico pool feeds 3 buckets, so size up
  intlWorld:       25, // intl pool feeds 2 buckets, so size up
  intlTravelStyle: 15,
  medicineTech:    20,
  genai:           15,
};

export function chicagoHour(now = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', hour: 'numeric', hour12: false,
  });
  const h = parseInt(fmt.formatToParts(now).find(p => p.type === 'hour')?.value, 10);
  return h === 24 ? 0 : h;
}

export function shouldRun(now = new Date(), env = process.env) {
  if (env.FORCE_RUN === '1') return true;
  const h = chicagoHour(now);
  return h === 6 || h === 13;
}

async function main() {
  const now = new Date();

  if (!shouldRun(now)) {
    console.log(`[skip] Chicago hour is ${chicagoHour(now)}, not 6 or 13. FORCE_RUN=1 to override.`);
    process.exit(0);
  }

  const apiKey = process.env.NEWSAPI_KEY;
  if (!apiKey) {
    console.error('NEWSAPI_KEY env var is required.');
    process.exit(1);
  }

  // Fetch all pools in parallel.
  const [politics, medTech, genai, mexico, intl, ...weatherResults] = await Promise.allSettled([
    fetchCategory({ category: 'politics', apiKey, now }),
    fetchCategory({ category: 'medicine_tech', apiKey, now }),
    fetchGenAI({ now }),
    fetchMexico({ now }),
    fetchInternational({ now }),
    ...CITIES.map(c => fetchWeather({ city: c })),
  ]);

  const errors = [];
  const usPool       = handle(politics, errors, 'usPolitics',      s => pickTop(s, POOL.usPolitics, { balance: true }));
  const mexicoPool   = handle(mexico,   errors, 'mexico',          s => s.slice(0, POOL.mexico));
  const intlSplit    = handle(intl,     errors, 'international',   s => s, { world: [], travelStyle: [] });
  const intlWorld    = (intlSplit.world || []).slice(0, POOL.intlWorld);
  const intlTravel   = (intlSplit.travelStyle || []).slice(0, POOL.intlTravelStyle);
  const medPool      = handle(medTech,  errors, 'medicineTech',    s => pickTop(s, POOL.medicineTech));
  const genPool      = handle(genai,    errors, 'genai',           s => pickTopGenAI(s, POOL.genai));

  const weather = weatherResults.map((r, i) => {
    if (r.status === 'fulfilled') return r.value;
    errors.push(`weather:${CITIES[i].id} ${r.reason?.message}`);
    return null;
  }).filter(Boolean);

  // Recency-based fallback structure (used if Claude unavailable / fails).
  const fallback = {
    us: { politics: usPool.slice(0, STORIES_PER_BUCKET) },
    mexico: {
      politics: mexicoPool.filter(s => !s.isOaxaca).slice(0, STORIES_PER_BUCKET),
      culture: mexicoPool.filter(s => !s.isOaxaca).slice(STORIES_PER_BUCKET, STORIES_PER_BUCKET * 2),
      oaxacaCoast: mexicoPool.filter(s => s.isOaxaca).slice(0, STORIES_PER_BUCKET),
    },
    international: {
      politics: intlWorld.slice(0, STORIES_PER_BUCKET),
      generalNews: intlWorld.slice(STORIES_PER_BUCKET, STORIES_PER_BUCKET * 2),
      travelStyle: intlTravel.slice(0, STORIES_PER_BUCKET),
    },
    medicineTech: medPool.slice(0, STORIES_PER_BUCKET),
    genai: genPool.slice(0, STORIES_PER_BUCKET),
    dailyBrief: '',
  };

  let picked = fallback;
  let curationMeta = { used: false };

  if (claudeAvailable()) {
    const curated = await curateAll({
      candidates: {
        usPolitics: usPool,
        mexico: mexicoPool,
        intlWorld: intlWorld,
        intlTravelStyle: intlTravel,
        medicineTech: medPool,
        genai: genPool,
      },
      n: STORIES_PER_BUCKET,
    });
    if (curated.ok) {
      picked = mergeWithFallback(curated, fallback);
      curationMeta = { used: true, model: curated.model, tokens: curated.tokens };
    } else {
      errors.push(`claude-curator: ${curated.error}`);
    }
  }

  const data = {
    generatedAt: now.toISOString(),
    dailyBrief: picked.dailyBrief,
    weather,
    us: picked.us,
    mexico: picked.mexico,
    international: picked.international,
    medicineTech: picked.medicineTech,
    genai: picked.genai,
    curation: curationMeta,
    errors,
  };

  // If everything failed, leave existing data.json alone.
  const totalStories =
    data.us.politics.length +
    data.mexico.politics.length + data.mexico.culture.length + data.mexico.oaxacaCoast.length +
    data.international.politics.length + data.international.generalNews.length + data.international.travelStyle.length +
    data.medicineTech.length + data.genai.length;
  if (totalStories === 0 && weather.length === 0) {
    console.error('All sources failed. Leaving existing data.json untouched.');
    console.error('Errors:', errors);
    process.exit(1);
  }

  await fs.mkdir(path.dirname(DATA_PATH), { recursive: true });
  await fs.writeFile(DATA_PATH, JSON.stringify(data, null, 2) + '\n');
  console.log(`[ok] wrote ${DATA_PATH} (${totalStories} stories, ${weather.length} weather, errors=${errors.length})`);
  if (errors.length) console.warn('[warn] partial errors:', errors);
}

function handle(settled, errors, label, picker, defaultValue = []) {
  if (settled.status === 'fulfilled') return picker(settled.value);
  errors.push(`${label}: ${settled.reason?.message || settled.reason}`);
  return defaultValue;
}

// Replace empty buckets in `curated` with the fallback equivalents so that
// a partial failure in Claude's bucketing doesn't blank out a column.
export function mergeWithFallback(curated, fallback) {
  const pick = (a, b) => (a && a.length ? a : b);
  return {
    us: { politics: pick(curated.us?.politics, fallback.us.politics) },
    mexico: {
      politics:    pick(curated.mexico?.politics,    fallback.mexico.politics),
      culture:     pick(curated.mexico?.culture,     fallback.mexico.culture),
      oaxacaCoast: pick(curated.mexico?.oaxacaCoast, fallback.mexico.oaxacaCoast),
    },
    international: {
      politics:    pick(curated.international?.politics,    fallback.international.politics),
      generalNews: pick(curated.international?.generalNews, fallback.international.generalNews),
      travelStyle: pick(curated.international?.travelStyle, fallback.international.travelStyle),
    },
    medicineTech: pick(curated.medicineTech, fallback.medicineTech),
    genai:        pick(curated.genai,        fallback.genai),
    dailyBrief:   curated.dailyBrief || '',
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(e => { console.error(e); process.exit(1); });
}

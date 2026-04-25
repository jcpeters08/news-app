// Orchestrator: gates on exact local time (America/Chicago 6am or 1pm), fetches all data,
// writes public/data.json. On any failure, leaves the existing data.json in place.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchCategory, pickTop } from './fetch-news.mjs';
import { fetchGenAI, pickTopGenAI } from './fetch-genai.mjs';
import { fetchWeather, CITIES } from './fetch-weather.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA_PATH = path.join(ROOT, 'public', 'data.json');

const STORIES_PER_CATEGORY = 5;

// Returns the current hour in America/Chicago (0-23) regardless of host TZ or DST.
export function chicagoHour(now = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    hour: 'numeric',
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const h = parts.find(p => p.type === 'hour')?.value;
  // Intl can return "24" for midnight in some locales; normalize.
  const n = parseInt(h, 10);
  return n === 24 ? 0 : n;
}

// Should we run a scheduled build at this UTC time? Returns true only if
// it's exactly 6am or 1pm in America/Chicago — DST-safe year-round.
// Override with FORCE_RUN=1 for manual runs.
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

  // Fetch all categories in parallel; partial failures don't kill the whole build.
  const results = await Promise.allSettled([
    fetchCategory({ category: 'politics', apiKey, now }),
    fetchCategory({ category: 'medicine_tech', apiKey, now }),
    fetchGenAI({ now }),
    ...CITIES.map(c => fetchWeather({ city: c })),
  ]);

  const [politics, medTech, genai, ...weatherResults] = results;

  const errors = [];
  const data = {
    generatedAt: now.toISOString(),
    politics: handle(politics, errors, 'politics', s => pickTop(s, STORIES_PER_CATEGORY, { balance: true })),
    medicineTech: handle(medTech, errors, 'medicineTech', s => pickTop(s, STORIES_PER_CATEGORY)),
    genai: handle(genai, errors, 'genai', s => pickTopGenAI(s, STORIES_PER_CATEGORY)),
    weather: weatherResults.map((r, i) => {
      if (r.status === 'fulfilled') return r.value;
      errors.push(`weather:${CITIES[i].id} ${r.reason?.message}`);
      return null;
    }).filter(Boolean),
    errors,
  };

  // If everything failed, don't overwrite existing data.json.
  const allEmpty =
    data.politics.length === 0 &&
    data.medicineTech.length === 0 &&
    data.genai.length === 0 &&
    data.weather.length === 0;

  if (allEmpty) {
    console.error('All sources failed. Leaving existing data.json untouched.');
    console.error('Errors:', errors);
    process.exit(1);
  }

  await fs.mkdir(path.dirname(DATA_PATH), { recursive: true });
  await fs.writeFile(DATA_PATH, JSON.stringify(data, null, 2) + '\n');
  console.log(`[ok] wrote ${DATA_PATH}`);
  if (errors.length) console.warn('[warn] partial errors:', errors);
}

function handle(settled, errors, label, picker) {
  if (settled.status === 'fulfilled') return picker(settled.value);
  errors.push(`${label}: ${settled.reason?.message || settled.reason}`);
  return [];
}

// Only run main when invoked as a script.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(e => {
    console.error(e);
    process.exit(1);
  });
}

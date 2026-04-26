import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(__dirname, '..', 'public');

function makeForecast(dows) {
  return dows.map((dow, i) => ({
    date: `2026-04-${25 + i}`, dow, highF: 70 + i, lowF: 50 + i,
    precipChance: i === 2 ? 80 : 0, code: 0, condition: 'Clear', icon: '☀️', uvMax: 5,
  }));
}

const story = (over = {}) => ({
  title: 'Sample story', url: 'https://x/sample', source: 'Reuters',
  publishedAt: new Date().toISOString(), ...over,
});

const SAMPLE = {
  generatedAt: new Date().toISOString(),
  dailyBrief: 'Today: NATO friction; AI drug trial milestone; Oaxaca tourism record.',
  weather: [
    { cityId: 'minneapolis', cityName: 'Minneapolis',
      current: { tempF: 51, condition: 'Overcast', icon: '☁️', windMph: 8, humidity: 60 },
      uv: { max: 5, level: 'moderate', label: 'Moderate' },
      tides: null,
      today: { highF: 60, lowF: 45, precipChance: 36 },
      forecast: makeForecast(['Sat','Sun','Mon','Tue','Wed','Thu','Fri']) },
    { cityId: 'mexico_city', cityName: 'Mexico City',
      current: { tempF: 79, condition: 'Clear', icon: '☀️', windMph: 6, humidity: 40 },
      uv: { max: 9, level: 'very-high', label: 'Very High' },
      tides: null,
      today: { highF: 81, lowF: 55, precipChance: 0 },
      forecast: makeForecast(['Sat','Sun','Mon','Tue','Wed','Thu','Fri']) },
    { cityId: 'puerto_escondido', cityName: 'Puerto Escondido',
      current: { tempF: 82, condition: 'Mostly clear', icon: '🌤️', windMph: 12, humidity: 70 },
      uv: { max: 11, level: 'extreme', label: 'Extreme' },
      tides: [
        { type: 'H', date: '2026-04-25', time: '02:45', timeLabel: '2:45 AM', heightFt: 4.8, heightM: 1.46 },
        { type: 'L', date: '2026-04-25', time: '09:12', timeLabel: '9:12 AM', heightFt: 1.1, heightM: 0.34 },
        { type: 'H', date: '2026-04-25', time: '15:18', timeLabel: '3:18 PM', heightFt: 5.2, heightM: 1.58 },
        { type: 'L', date: '2026-04-25', time: '21:48', timeLabel: '9:48 PM', heightFt: 0.8, heightM: 0.24 },
      ],
      today: { highF: 86, lowF: 75, precipChance: 0 },
      forecast: makeForecast(['Sat','Sun','Mon','Tue','Wed','Thu','Fri']) },
  ],
  us: {
    politics: [
      story({ title: 'US story 1', url: 'https://x/us1', source: 'CBS News',
        bias: 'lean-left', biasLabel: 'Lean Left',
        description: 'Bipartisan vote on infrastructure.',
        whyItMatters: 'Big policy shift on broadband.' }),
      story({ title: 'US story 2', url: 'https://x/us2', source: 'Fox News',
        bias: 'lean-right', biasLabel: 'Lean Right',
        description: 'Border policy hearing.' }),
    ],
  },
  mexico: {
    politics: [
      story({ title: 'Sheinbaum visit', url: 'https://x/mx1', source: 'Reforma',
        region: 'mexico', isOaxaca: false, language: 'es',
        description: 'Bilateral talks.' }),
    ],
    culture: [
      story({ title: 'Mezcal scene', url: 'https://x/mx2', source: 'Mexico News Daily',
        region: 'mexico', isOaxaca: false,
        description: 'Heirloom agave varieties.' }),
    ],
    oaxacaCoast: [
      story({ title: 'Puerto Escondido tourism record', url: 'https://x/mx3', source: 'NSS Oaxaca',
        region: 'mexico', isOaxaca: true, language: 'es',
        description: 'Ocupación 92%.',
        whyItMatters: 'Crowded surf at La Punta.' }),
    ],
  },
  international: {
    politics: [
      story({ title: 'NATO friction', url: 'https://x/iw1', source: 'BBC News',
        region: 'international', description: 'European pushback.' }),
    ],
    generalNews: [
      story({ title: 'Antarctic sea ice low', url: 'https://x/iw2', source: 'Reuters',
        region: 'international', description: 'Satellite signal.' }),
    ],
    travelStyle: [
      story({ title: 'Best new hotels 2026', url: 'https://x/it1', source: 'Condé Nast Traveler',
        region: 'international', kind: 'travel', description: 'Annual list.' }),
      story({ title: 'Relaxed tailoring returns', url: 'https://x/it2', source: 'GQ',
        region: 'international', kind: 'style' }),
    ],
  },
  medicineTech: [
    story({ title: 'AI-designed drugs to trials', url: 'https://x/m1', source: 'Wired',
      description: 'Phase 1 begins.' }),
  ],
  genai: [
    story({ title: 'How to use MCP servers', url: 'https://x/g1', source: 'Simon Willison',
      description: 'Walkthrough.', whyItMatters: 'MCP is the lingua franca right now.' }),
  ],
  errors: [],
};

let dom;

// Default to America/New_York so tests are deterministic regardless of host TZ
// (smart-detect would otherwise return 'mx' on a machine in Mexico City).
async function setupDom(data = SAMPLE, { tz = 'America/New_York' } = {}) {
  const html = await fs.readFile(path.join(PUBLIC, 'index.html'), 'utf8');
  const css = await fs.readFile(path.join(PUBLIC, 'styles.css'), 'utf8');
  const appJs = await fs.readFile(path.join(PUBLIC, 'app.js'), 'utf8');

  dom = new JSDOM(
    html.replace('<link rel="stylesheet" href="styles.css" />', `<style>${css}</style>`)
        .replace('<script src="app.js"></script>', ''),
    { url: 'http://localhost/', runScripts: 'dangerously', resources: 'usable' }
  );

  if (tz) {
    // Override Intl resolvedOptions to simulate a different timezone.
    const origIntl = dom.window.Intl;
    dom.window.Intl = new Proxy(origIntl, {
      get(target, prop) {
        if (prop === 'DateTimeFormat') {
          return new Proxy(target.DateTimeFormat, {
            construct(t, args) {
              const inst = new t(...args);
              const origResolve = inst.resolvedOptions.bind(inst);
              inst.resolvedOptions = () => ({ ...origResolve(), timeZone: tz });
              return inst;
            },
            apply(t, _self, args) {
              const inst = new t(...args);
              const origResolve = inst.resolvedOptions.bind(inst);
              inst.resolvedOptions = () => ({ ...origResolve(), timeZone: tz });
              return inst;
            },
          });
        }
        return target[prop];
      },
    });
  }

  dom.window.fetch = async () => ({ ok: true, json: async () => data });
  // Clean localStorage between runs.
  try { dom.window.localStorage.clear(); } catch {}

  const scriptEl = dom.window.document.createElement('script');
  scriptEl.textContent = appJs;
  dom.window.document.body.appendChild(scriptEl);
  await new Promise(r => setTimeout(r, 80));
  return dom.window.document;
}

describe('frontend tabbed render', () => {
  it('renders daily brief', async () => {
    const doc = await setupDom();
    expect(doc.getElementById('brief').hidden).toBe(false);
    expect(doc.getElementById('brief-text').textContent).toContain('Oaxaca');
  });

  it('renders 3 weather cards with UV badges', async () => {
    const doc = await setupDom();
    const cards = doc.querySelectorAll('.weather-card');
    expect(cards.length).toBe(3);
    expect(cards[2].textContent).toContain('Puerto Escondido');
    const uvBadges = doc.querySelectorAll('.uv-badge');
    expect(uvBadges.length).toBe(3);
    expect(uvBadges[2].classList.contains('uv-extreme')).toBe(true);
    expect(uvBadges[2].textContent).toContain('UV 11');
  });

  it('renders tides only on Puerto Escondido card', async () => {
    const doc = await setupDom();
    const cards = doc.querySelectorAll('.weather-card');
    expect(cards[0].querySelector('.tides')).toBeNull();
    expect(cards[1].querySelector('.tides')).toBeNull();
    const peTides = cards[2].querySelectorAll('.tide-row');
    expect(peTides.length).toBe(4);
    expect(peTides[2].textContent).toContain('3:18 PM');
    expect(peTides[2].textContent).toContain('5.2 ft');
  });

  it('renders always-on Med/Tech and GenAI columns regardless of tab', async () => {
    const doc = await setupDom();
    expect(doc.querySelectorAll('#medicineTech .story').length).toBe(1);
    expect(doc.querySelectorAll('#genai .story').length).toBe(1);
  });

  it('US tab shows only US politics column (default in non-Mexico timezone)', async () => {
    const doc = await setupDom();
    expect(doc.querySelector('[data-pane="us"]').hidden).toBe(false);
    expect(doc.querySelector('[data-pane="mx"]').hidden).toBe(true);
    expect(doc.querySelector('[data-pane="intl"]').hidden).toBe(true);
    expect(doc.querySelectorAll('#us-politics .story').length).toBe(2);
  });

  it('smart-detect defaults to Mexico tab when in a Mexican timezone', async () => {
    const doc = await setupDom(SAMPLE, { tz: 'America/Mexico_City' });
    expect(doc.querySelector('[data-pane="mx"]').hidden).toBe(false);
    expect(doc.querySelector('[data-pane="us"]').hidden).toBe(true);
  });

  it('clicking Mexico tab reveals 3 sub-columns', async () => {
    const doc = await setupDom();
    const mxTab = doc.querySelector('.tab[data-tab="mx"]');
    mxTab.click();
    expect(doc.querySelector('[data-pane="us"]').hidden).toBe(true);
    expect(doc.querySelector('[data-pane="mx"]').hidden).toBe(false);
    expect(doc.querySelectorAll('#mx-politics .story').length).toBe(1);
    expect(doc.querySelectorAll('#mx-culture .story').length).toBe(1);
    expect(doc.querySelectorAll('#mx-oaxaca .story').length).toBe(1);
  });

  it('clicking International tab reveals 3 sub-columns', async () => {
    const doc = await setupDom();
    doc.querySelector('.tab[data-tab="intl"]').click();
    expect(doc.querySelector('[data-pane="intl"]').hidden).toBe(false);
    expect(doc.querySelectorAll('#intl-politics .story').length).toBe(1);
    expect(doc.querySelectorAll('#intl-general .story').length).toBe(1);
    expect(doc.querySelectorAll('#intl-travel .story').length).toBe(2);
  });

  it('renders bias badges on US stories and Mexico/Oaxaca region badges', async () => {
    const doc = await setupDom();
    const usBadges = doc.querySelectorAll('#us-politics .bias');
    expect(usBadges[0].classList.contains('bias-lean-left')).toBe(true);
    expect(usBadges[1].classList.contains('bias-lean-right')).toBe(true);
    // Switch to MX
    doc.querySelector('.tab[data-tab="mx"]').click();
    const oaxacaBadge = doc.querySelector('#mx-oaxaca .bias');
    expect(oaxacaBadge.classList.contains('region-oaxaca')).toBe(true);
    expect(oaxacaBadge.textContent).toContain('Oaxaca');
  });

  it('renders ES tag on Spanish-language stories', async () => {
    const doc = await setupDom();
    doc.querySelector('.tab[data-tab="mx"]').click();
    const oaxacaLang = doc.querySelector('#mx-oaxaca .lang-tag');
    expect(oaxacaLang).toBeTruthy();
    expect(oaxacaLang.textContent).toBe('ES');
  });

  it('renders whyItMatters where present', async () => {
    const doc = await setupDom();
    expect(doc.querySelector('#us-politics .story-why').textContent).toContain('broadband');
    expect(doc.querySelector('#genai .story-why').textContent).toContain('lingua franca');
  });

  it('shows count badges', async () => {
    const doc = await setupDom();
    expect(doc.getElementById('count-medicineTech').textContent).toContain('1 story');
    expect(doc.getElementById('count-us-politics').textContent).toContain('2 stories');
  });

  it('hides daily brief section when empty', async () => {
    const doc = await setupDom({ ...SAMPLE, dailyBrief: '' });
    expect(doc.getElementById('brief').hidden).toBe(true);
  });

  it('shows error count in meta when errors exist', async () => {
    const doc = await setupDom({ ...SAMPLE, errors: ['weather:minneapolis timeout'] });
    expect(doc.getElementById('meta').textContent).toContain('1 source error');
  });

  it('renders 6-day forecast strip on every weather card', async () => {
    const doc = await setupDom();
    const cards = doc.querySelectorAll('.weather-card');
    for (const card of cards) {
      expect(card.querySelectorAll('.forecast-day').length).toBe(6);
    }
  });
});

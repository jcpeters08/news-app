import { describe, it, expect, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(__dirname, '..', 'public');

const SAMPLE = {
  generatedAt: new Date().toISOString(),
  politics: [
    { title: 'P1', url: 'https://x/p1', source: 'Reuters', sourceId: 'reuters', bias: 'center', biasLabel: 'Center', publishedAt: new Date().toISOString() },
    { title: 'P2', url: 'https://x/p2', source: 'Fox News', sourceId: 'fox-news', bias: 'lean-right', biasLabel: 'Lean Right', publishedAt: new Date().toISOString() },
  ],
  medicineTech: [
    { title: 'M1', url: 'https://x/m1', source: 'Ars Technica', publishedAt: new Date().toISOString() },
  ],
  genai: [
    { title: 'G1', url: 'https://x/g1', source: 'Anthropic', publishedAt: new Date().toISOString() },
  ],
  weather: [
    { cityId: 'minneapolis', cityName: 'Minneapolis',
      current: { tempF: 62, condition: 'Partly cloudy', icon: '🌤️', windMph: 8, humidity: 48 },
      today: { highF: 68, lowF: 45, precipChance: 10 } },
    { cityId: 'puerto_escondido', cityName: 'Puerto Escondido',
      current: { tempF: 84, condition: 'Clear', icon: '☀️', windMph: 12, humidity: 70 },
      today: { highF: 88, lowF: 75, precipChance: 0 } },
  ],
  errors: [],
};

let dom;

async function setupDom(data = SAMPLE) {
  const html = await fs.readFile(path.join(PUBLIC, 'index.html'), 'utf8');
  const css = await fs.readFile(path.join(PUBLIC, 'styles.css'), 'utf8');
  const appJs = await fs.readFile(path.join(PUBLIC, 'app.js'), 'utf8');

  dom = new JSDOM(html.replace('<link rel="stylesheet" href="styles.css" />', `<style>${css}</style>`).replace('<script src="app.js"></script>', ''), {
    url: 'http://localhost/',
    runScripts: 'dangerously',
    resources: 'usable',
  });

  // Stub fetch to return SAMPLE.
  dom.window.fetch = async () => ({
    ok: true,
    json: async () => data,
  });

  // Now eval app.js inside the JSDOM window.
  const scriptEl = dom.window.document.createElement('script');
  scriptEl.textContent = appJs;
  dom.window.document.body.appendChild(scriptEl);

  // Allow microtasks to drain.
  await new Promise(r => setTimeout(r, 50));
  return dom.window.document;
}

describe('frontend render', () => {
  it('renders 2 politics stories with bias badges', async () => {
    const doc = await setupDom();
    const items = doc.querySelectorAll('#politics .story');
    expect(items.length).toBe(2);
    const badges = doc.querySelectorAll('#politics .bias');
    expect(badges.length).toBe(2);
    expect(badges[0].classList.contains('bias-center')).toBe(true);
    expect(badges[1].classList.contains('bias-lean-right')).toBe(true);
  });

  it('renders 2 weather cards', async () => {
    const doc = await setupDom();
    const cards = doc.querySelectorAll('#weather-cards .weather-card');
    expect(cards.length).toBe(2);
    expect(cards[0].textContent).toContain('Minneapolis');
    expect(cards[1].textContent).toContain('Puerto Escondido');
  });

  it('opens story links in a new tab with safe rel', async () => {
    const doc = await setupDom();
    const a = doc.querySelector('#politics .story a');
    expect(a.target).toBe('_blank');
    expect(a.rel).toContain('noopener');
  });

  it('shows "Last updated" meta', async () => {
    const doc = await setupDom();
    const meta = doc.getElementById('meta');
    expect(meta.textContent).toMatch(/Last updated/);
  });

  it('shows empty state when a category is empty', async () => {
    const doc = await setupDom({ ...SAMPLE, genai: [] });
    expect(doc.querySelector('#genai .empty')).toBeTruthy();
  });

  it('shows error count in meta when errors exist', async () => {
    const doc = await setupDom({ ...SAMPLE, errors: ['weather:minneapolis timeout'] });
    expect(doc.getElementById('meta').textContent).toContain('1 source error');
  });
});

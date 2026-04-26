import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchMexico, fetchFeedXml } from '../scripts/fetch-mexico.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function loadFixture(name, now) {
  const raw = await fs.readFile(path.join(__dirname, 'fixtures', name), 'utf8');
  return raw.replaceAll('REPLACE_NOW', now.toUTCString());
}

describe('fetchMexico', () => {
  it('parses Oaxaca-specific feed and tags isOaxaca=true', async () => {
    const now = new Date();
    const xml = await loadFixture('rss-oaxaca.xml', now);
    const buf = new TextEncoder().encode(xml).buffer;
    const fakeFetch = async () => ({ ok: true, arrayBuffer: async () => buf });
    const items = await fetchMexico({
      fetchImpl: fakeFetch, now,
      feeds: [{ url: 'https://nss.test/rss', source: 'NSS Oaxaca', language: 'es', weight: 13, oaxaca: true }],
    });
    expect(items.length).toBe(2);
    expect(items.every(i => i.isOaxaca)).toBe(true);
    expect(items.every(i => i.region === 'mexico')).toBe(true);
    expect(items.every(i => i.bias === null)).toBe(true);
    expect(items[0].language).toBe('es');
    expect(items[0].category).toBe('politics');
  });

  it('detects Oaxaca mentions in non-Oaxaca feeds via keyword scan', async () => {
    const now = new Date();
    const xml = await loadFixture('rss-mexico-news-daily.xml', now);
    const buf = new TextEncoder().encode(xml).buffer;
    const fakeFetch = async () => ({ ok: true, arrayBuffer: async () => buf });
    const items = await fetchMexico({
      fetchImpl: fakeFetch, now,
      feeds: [{ url: 'https://mnd.test/feed', source: 'Mexico News Daily', language: 'en', weight: 12 }],
    });
    const oaxacaItem = items.find(i => /Huatulco/i.test(i.title));
    const otherItem = items.find(i => /Sheinbaum/i.test(i.title));
    expect(oaxacaItem.isOaxaca).toBe(true);
    expect(otherItem.isOaxaca).toBe(false);
  });

  it('ranks Oaxaca-mentioning stories above non-Oaxaca within the same feed', async () => {
    const now = new Date();
    const xml = await loadFixture('rss-mexico-news-daily.xml', now);
    const buf = new TextEncoder().encode(xml).buffer;
    const fakeFetch = async () => ({ ok: true, arrayBuffer: async () => buf });
    const items = await fetchMexico({
      fetchImpl: fakeFetch, now,
      feeds: [{ url: 'https://mnd.test/feed', source: 'Mexico News Daily', language: 'en', weight: 12 }],
    });
    expect(/Huatulco|Oaxaca/i.test(items[0].title)).toBe(true);
  });

  it('skips items older than the 36h window', async () => {
    const now = new Date();
    const xml = `<?xml version="1.0"?><rss version="2.0"><channel>
      <item><title>Old Mexico story</title><link>https://x/old</link>
        <description>Too old.</description><pubDate>Sun, 01 Jan 2020 00:00:00 GMT</pubDate></item>
      <item><title>Fresh Mexico story</title><link>https://x/fresh</link>
        <description>Recent.</description><pubDate>${now.toUTCString()}</pubDate></item>
    </channel></rss>`;
    const buf = new TextEncoder().encode(xml).buffer;
    const fakeFetch = async () => ({ ok: true, arrayBuffer: async () => buf });
    const items = await fetchMexico({
      fetchImpl: fakeFetch, now,
      feeds: [{ url: 'https://x.test/rss', source: 'Test', language: 'es', weight: 5 }],
    });
    expect(items.length).toBe(1);
    expect(items[0].title).toBe('Fresh Mexico story');
  });

  it('caps total items at maxItems', async () => {
    const now = new Date();
    const itemsXml = Array.from({ length: 50 }, (_, i) =>
      `<item><title>Story ${i}</title><link>https://x/${i}</link><pubDate>${now.toUTCString()}</pubDate></item>`
    ).join('');
    const xml = `<?xml version="1.0"?><rss version="2.0"><channel>${itemsXml}</channel></rss>`;
    const buf = new TextEncoder().encode(xml).buffer;
    const fakeFetch = async () => ({ ok: true, arrayBuffer: async () => buf });
    const items = await fetchMexico({
      fetchImpl: fakeFetch, now, maxItems: 10,
      feeds: [{ url: 'https://x.test/rss', source: 'Test', language: 'es', weight: 5 }],
    });
    expect(items.length).toBe(10);
  });

  it('continues when one feed errors', async () => {
    const now = new Date();
    const xml = await loadFixture('rss-mexico-news-daily.xml', now);
    const buf = new TextEncoder().encode(xml).buffer;
    let call = 0;
    const fakeFetch = async () => {
      call++;
      if (call === 1) return { ok: false, status: 503, statusText: 'down' };
      return { ok: true, arrayBuffer: async () => buf };
    };
    const items = await fetchMexico({
      fetchImpl: fakeFetch, now,
      feeds: [
        { url: 'https://broken.test/rss', source: 'Broken', language: 'es', weight: 5 },
        { url: 'https://ok.test/rss', source: 'MND', language: 'en', weight: 12 },
      ],
    });
    expect(items.length).toBeGreaterThan(0);
  });
});

describe('fetchFeedXml encoding detection', () => {
  it('decodes utf-8 by default', async () => {
    const xml = '<?xml version="1.0" encoding="UTF-8"?><rss><channel><title>café ñ</title></channel></rss>';
    const buf = new TextEncoder().encode(xml).buffer;
    const fakeFetch = async () => ({ ok: true, arrayBuffer: async () => buf });
    const out = await fetchFeedXml('https://x.test', fakeFetch);
    expect(out).toContain('café ñ');
  });

  it('decodes iso-8859-1 when declared (Reforma case)', async () => {
    // Build a buffer with iso-8859-1 bytes for "últimas"
    const head = '<?xml version="1.0" encoding="iso-8859-1"?><rss><channel><title>';
    const tail = '</title></channel></rss>';
    const headBytes = new Uint8Array([...head].map(c => c.charCodeAt(0)));
    // 'ú' in latin1 = 0xFA
    const middle = new Uint8Array([0xFA, 0x6C, 0x74, 0x69, 0x6D, 0x61, 0x73]); // úl t i m a s
    const tailBytes = new Uint8Array([...tail].map(c => c.charCodeAt(0)));
    const buf = new Uint8Array(headBytes.length + middle.length + tailBytes.length);
    buf.set(headBytes, 0);
    buf.set(middle, headBytes.length);
    buf.set(tailBytes, headBytes.length + middle.length);
    const fakeFetch = async () => ({ ok: true, arrayBuffer: async () => buf.buffer });
    const out = await fetchFeedXml('https://x.test', fakeFetch);
    expect(out).toContain('últimas');
  });

  it('throws on non-OK response', async () => {
    const fakeFetch = async () => ({ ok: false, status: 404, statusText: 'Not Found' });
    await expect(fetchFeedXml('https://x.test', fakeFetch)).rejects.toThrow(/404/);
  });
});

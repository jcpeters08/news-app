import { describe, it, expect } from 'vitest';
import {
  curateAll, buildPrompt, parseJson, applyPicks, isAvailable,
} from '../scripts/claude-curator.mjs';

const sampleCands = {
  usPolitics: [
    { title: 'Senate passes infrastructure bill', source: 'CBS News', biasLabel: 'Lean Left',
      publishedAt: new Date().toISOString(), url: 'https://x/us0', description: 'Bipartisan vote.' },
    { title: 'DOJ adds firing-squad option', source: 'Breitbart', biasLabel: 'Right',
      publishedAt: new Date().toISOString(), url: 'https://x/us1', description: 'Federal protocol revised.' },
  ],
  mexico: [
    { title: 'Llegada de turistas a Puerto Escondido marca récord', source: 'NSS Oaxaca',
      region: 'mexico', isOaxaca: true, language: 'es',
      publishedAt: new Date().toISOString(), url: 'https://x/mx0',
      description: 'Ocupación 92%.' },
    { title: 'Banxico holds rate at 8.50%', source: 'BBC Mundo',
      region: 'mexico', isOaxaca: false, language: 'es',
      publishedAt: new Date().toISOString(), url: 'https://x/mx1',
      description: 'Pausa de ciclo.' },
    { title: 'Mezcal scene gets ingredient-driven update in CDMX', source: 'Mexico News Daily',
      region: 'mexico', isOaxaca: false, language: 'en',
      publishedAt: new Date().toISOString(), url: 'https://x/mx2',
      description: 'Heirloom agave varieties.' },
  ],
  intlWorld: [
    { title: 'NATO allies push back at US threat to Spain', source: 'BBC News',
      region: 'international', publishedAt: new Date().toISOString(),
      url: 'https://x/iw0', description: 'European leaders reject pressure.' },
    { title: 'Antarctic sea ice hits new winter low', source: 'Reuters',
      region: 'international', publishedAt: new Date().toISOString(),
      url: 'https://x/iw1', description: 'Satellite data shows record.' },
  ],
  intlTravelStyle: [
    { title: 'The 25 best new hotels in the world for 2026', source: 'Condé Nast Traveler',
      region: 'international', kind: 'travel', publishedAt: new Date().toISOString(),
      url: 'https://x/it0', description: 'Annual ranking.' },
    { title: 'Looser, longer, easier: the return of relaxed tailoring', source: 'GQ',
      region: 'international', kind: 'style', publishedAt: new Date().toISOString(),
      url: 'https://x/it1', description: 'Fall trend.' },
  ],
  medicineTech: [
    { title: 'AI-Designed Drugs Headed to Human Trials', source: 'Wired',
      publishedAt: new Date().toISOString(), url: 'https://x/m0',
      description: 'Phase 1 trials open.' },
  ],
  genai: [
    { title: 'How to use MCP servers with Claude', source: 'Simon Willison',
      publishedAt: new Date().toISOString(), url: 'https://x/g0',
      description: 'Practical walkthrough.' },
  ],
};

describe('isAvailable', () => {
  it('false when key missing', () => expect(isAvailable({})).toBe(false));
  it('true when key present', () => expect(isAvailable({ ANTHROPIC_API_KEY: 'sk-ant-x' })).toBe(true));
});

describe('buildPrompt', () => {
  it('lists candidates from each pool with id prefixes per pool', () => {
    const tagged = {
      usPolitics:       sampleCands.usPolitics.map((s, i) => ({ ...s, _id: `us_${i}` })),
      mexico:           sampleCands.mexico.map((s, i) => ({ ...s, _id: `mx_${i}` })),
      intlWorld:        sampleCands.intlWorld.map((s, i) => ({ ...s, _id: `iw_${i}` })),
      intlTravelStyle:  sampleCands.intlTravelStyle.map((s, i) => ({ ...s, _id: `it_${i}` })),
      medicineTech:     sampleCands.medicineTech.map((s, i) => ({ ...s, _id: `m_${i}` })),
      genai:            sampleCands.genai.map((s, i) => ({ ...s, _id: `g_${i}` })),
    };
    const prompt = buildPrompt(tagged, 5);
    expect(prompt).toContain('us_0:');
    expect(prompt).toContain('mx_0:');
    expect(prompt).toContain('iw_0:');
    expect(prompt).toContain('it_0:');
    expect(prompt).toContain('m_0:');
    expect(prompt).toContain('g_0:');
    // Oaxaca-flagged candidates get a marker
    expect(prompt).toContain('★Oaxaca');
    // Spanish language indicated
    expect(prompt).toContain('(es)');
    // Travel/style kind tagged
    expect(prompt).toMatch(/<travel>|<style>/);
  });
});

describe('parseJson', () => {
  it('parses raw JSON', () => expect(parseJson('{"a":1}')).toEqual({ a: 1 }));
  it('strips trailing prose', () => expect(parseJson('{"a":1}\nNote: extra')).toEqual({ a: 1 }));
  it('handles nested braces', () => expect(parseJson('{"x":{"y":2}}')).toEqual({ x: { y: 2 } }));
  it('throws on no object', () => expect(() => parseJson('no braces')).toThrow());
});

describe('applyPicks (new tabbed shape)', () => {
  const tagged = {
    usPolitics:       sampleCands.usPolitics.map((s, i) => ({ ...s, _id: `us_${i}` })),
    mexico:           sampleCands.mexico.map((s, i) => ({ ...s, _id: `mx_${i}` })),
    intlWorld:        sampleCands.intlWorld.map((s, i) => ({ ...s, _id: `iw_${i}` })),
    intlTravelStyle:  sampleCands.intlTravelStyle.map((s, i) => ({ ...s, _id: `it_${i}` })),
    medicineTech:     sampleCands.medicineTech.map((s, i) => ({ ...s, _id: `m_${i}` })),
    genai:            sampleCands.genai.map((s, i) => ({ ...s, _id: `g_${i}` })),
  };

  it('routes picks into us / mexico / international / always-on', () => {
    const parsed = {
      us: { politics: [{ id: 'us_0', whyItMatters: 'Major bipartisan win.' }] },
      mexico: {
        politics:    [{ id: 'mx_1', whyItMatters: 'Banxico pause.' }],
        culture:     [{ id: 'mx_2', whyItMatters: 'Mezcal scene.' }],
        oaxacaCoast: [{ id: 'mx_0', whyItMatters: 'Oaxaca tourism record.' }],
      },
      international: {
        politics:    [{ id: 'iw_0', whyItMatters: 'NATO friction.' }],
        generalNews: [{ id: 'iw_1', whyItMatters: 'Climate signal.' }],
        travelStyle: [{ id: 'it_0', whyItMatters: 'Hotels list.' }, { id: 'it_1', whyItMatters: 'Tailoring trend.' }],
      },
      medicineTech: [{ id: 'm_0', whyItMatters: 'Phase 1 milestone.' }],
      genai:        [{ id: 'g_0', whyItMatters: 'Practical MCP guide.' }],
      dailyBrief:   'Today: NATO friction, AI drug trial milestone, Oaxaca tourism record.',
    };
    const out = applyPicks(tagged, parsed, 5);

    expect(out.us.politics[0].whyItMatters).toContain('bipartisan');
    expect(out.us.politics[0]._id).toBeUndefined();

    expect(out.mexico.oaxacaCoast[0].title).toContain('Puerto Escondido');
    expect(out.mexico.politics[0].title).toContain('Banxico');
    expect(out.mexico.culture[0].title).toContain('Mezcal');

    expect(out.international.politics[0].source).toBe('BBC News');
    expect(out.international.generalNews[0].title).toContain('Antarctic');
    expect(out.international.travelStyle).toHaveLength(2);

    expect(out.medicineTech[0].title).toContain('AI-Designed');
    expect(out.genai[0].title).toContain('MCP');

    expect(out.dailyBrief).toContain('Oaxaca');
  });

  it('drops invalid ids that Claude might invent', () => {
    const parsed = {
      us: { politics: [{ id: 'us_999', whyItMatters: 'invented' }, { id: 'us_0', whyItMatters: 'real' }] },
      mexico: { politics: [], culture: [], oaxacaCoast: [] },
      international: { politics: [], generalNews: [], travelStyle: [] },
      medicineTech: [], genai: [], dailyBrief: '',
    };
    const out = applyPicks(tagged, parsed, 5);
    expect(out.us.politics).toHaveLength(1);
    expect(out.us.politics[0].whyItMatters).toBe('real');
  });

  it('handles missing top-level keys gracefully', () => {
    const out = applyPicks(tagged, {}, 5);
    expect(out.us.politics).toEqual([]);
    expect(out.mexico).toEqual({ politics: [], culture: [], oaxacaCoast: [] });
    expect(out.international).toEqual({ politics: [], generalNews: [], travelStyle: [] });
    expect(out.dailyBrief).toBe('');
  });
});

describe('curateAll (mocked SDK)', () => {
  it('returns ok=false if no API key', async () => {
    const out = await curateAll({ candidates: sampleCands, env: {} });
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/ANTHROPIC_API_KEY/);
  });

  it('parses a well-formed Claude response into the new shape', async () => {
    const fakeResponse = {
      content: [{ type: 'text', text: `"us":{"politics":[{"id":"us_0","whyItMatters":"Senate passes."}]},
        "mexico":{"politics":[{"id":"mx_1","whyItMatters":"Rate hold."}],"culture":[{"id":"mx_2","whyItMatters":"Mezcal."}],"oaxacaCoast":[{"id":"mx_0","whyItMatters":"PE record."}]},
        "international":{"politics":[{"id":"iw_0","whyItMatters":"NATO."}],"generalNews":[{"id":"iw_1","whyItMatters":"Antarctic."}],"travelStyle":[{"id":"it_0","whyItMatters":"Hotels."}]},
        "medicineTech":[{"id":"m_0","whyItMatters":"Phase 1."}],
        "genai":[{"id":"g_0","whyItMatters":"MCP guide."}],
        "dailyBrief":"Themes: NATO friction; Phase-1 AI drug trials; Oaxaca tourism record."}` }],
      usage: { input_tokens: 10000, output_tokens: 1500 },
      model: 'claude-opus-4-5-test',
    };
    const fakeClient = { messages: { create: async () => fakeResponse } };
    const out = await curateAll({ candidates: sampleCands, client: fakeClient });
    expect(out.ok).toBe(true);
    expect(out.us.politics[0].whyItMatters).toContain('Senate');
    expect(out.mexico.oaxacaCoast[0].title).toContain('Puerto Escondido');
    expect(out.international.travelStyle[0].source).toBe('Condé Nast Traveler');
    expect(out.dailyBrief).toContain('Oaxaca');
    expect(out.tokens.input_tokens).toBe(10000);
    expect(out.model).toBe('claude-opus-4-5-test');
  });

  it('returns ok=false on malformed JSON', async () => {
    const fakeClient = { messages: { create: async () => ({ content: [{ type: 'text', text: 'not valid' }], usage: {}, model: 'x' }) } };
    const out = await curateAll({ candidates: sampleCands, client: fakeClient });
    expect(out.ok).toBe(false);
  });

  it('returns ok=false on SDK error', async () => {
    const fakeClient = { messages: { create: async () => { throw new Error('429 rate limit'); } } };
    const out = await curateAll({ candidates: sampleCands, client: fakeClient });
    expect(out.ok).toBe(false);
    expect(out.error).toContain('429');
  });

  it('passes prefs and bucketing rules via system prompt', async () => {
    let captured;
    const fakeClient = {
      messages: {
        create: async (args) => {
          captured = args;
          return { content: [{ type: 'text', text: '"us":{"politics":[]},"mexico":{"politics":[],"culture":[],"oaxacaCoast":[]},"international":{"politics":[],"generalNews":[],"travelStyle":[]},"medicineTech":[],"genai":[],"dailyBrief":""}' }], usage: {}, model: 'x' };
        },
      },
    };
    await curateAll({ candidates: sampleCands, client: fakeClient });
    expect(captured.system).toContain('Puerto Escondido');
    expect(captured.system).toContain('NEVER INCLUDE');
    expect(captured.system).toContain('OUTPUT FORMAT');
    expect(captured.system).toContain('BUCKETING RULES');
    expect(captured.system).toContain('oaxacaCoast');
    expect(captured.messages.at(-1)).toEqual({ role: 'assistant', content: '{' });
  });
});

import { describe, it, expect } from 'vitest';
import {
  curateAll, buildPrompt, parseJson, applyPicks, isAvailable,
} from '../scripts/claude-curator.mjs';

const sampleCands = {
  politics: [
    { title: 'Mexico storm hits Oaxaca coast', source: 'Reuters', biasLabel: 'Center', publishedAt: new Date().toISOString(), url: 'https://x/p0', description: 'Pacific storm makes landfall near Puerto Escondido.' },
    { title: 'US Senate passes infrastructure bill', source: 'CBS News', biasLabel: 'Lean Left', publishedAt: new Date().toISOString(), url: 'https://x/p1', description: 'Bipartisan vote.' },
    { title: 'Celebrity wedding photos', source: 'Fox News', biasLabel: 'Lean Right', publishedAt: new Date().toISOString(), url: 'https://x/p2', description: 'Should be excluded.' },
  ],
  medicineTech: [
    { title: 'New mRNA therapy clinical trial results', source: 'New Scientist', publishedAt: new Date().toISOString(), url: 'https://x/m0', description: 'Phase 3 results published.' },
  ],
  genai: [
    { title: 'How to use MCP servers with Claude', source: 'Simon Willison', publishedAt: new Date().toISOString(), url: 'https://x/g0', description: 'Practical walkthrough.' },
  ],
};

describe('isAvailable', () => {
  it('false when key missing', () => {
    expect(isAvailable({})).toBe(false);
  });
  it('true when key present', () => {
    expect(isAvailable({ ANTHROPIC_API_KEY: 'sk-ant-x' })).toBe(true);
  });
});

describe('buildPrompt', () => {
  it('lists candidates from each category with stable ids', () => {
    const tagged = {
      politics: sampleCands.politics.map((s, i) => ({ ...s, _id: `p_${i}` })),
      medicineTech: sampleCands.medicineTech.map((s, i) => ({ ...s, _id: `m_${i}` })),
      genai: sampleCands.genai.map((s, i) => ({ ...s, _id: `g_${i}` })),
    };
    const prompt = buildPrompt(tagged, 5);
    expect(prompt).toContain('p_0:');
    expect(prompt).toContain('m_0:');
    expect(prompt).toContain('g_0:');
    expect(prompt).toContain('Oaxaca');
    expect(prompt).toContain('mRNA');
    expect(prompt).toContain('MCP');
  });
});

describe('parseJson', () => {
  it('parses raw JSON', () => {
    expect(parseJson('{"a":1}')).toEqual({ a: 1 });
  });
  it('strips trailing prose', () => {
    expect(parseJson('{"a":1}\n\nNote: extra text')).toEqual({ a: 1 });
  });
  it('handles nested braces', () => {
    expect(parseJson('{"x":{"y":2}}')).toEqual({ x: { y: 2 } });
  });
  it('throws on no object', () => {
    expect(() => parseJson('no braces here')).toThrow();
  });
});

describe('applyPicks', () => {
  it('maps id picks back to candidates and attaches whyItMatters', () => {
    const tagged = {
      politics: sampleCands.politics.map((s, i) => ({ ...s, _id: `p_${i}` })),
      medicineTech: sampleCands.medicineTech.map((s, i) => ({ ...s, _id: `m_${i}` })),
      genai: sampleCands.genai.map((s, i) => ({ ...s, _id: `g_${i}` })),
    };
    const parsed = {
      politics: [
        { id: 'p_0', whyItMatters: 'Direct impact on Puerto Escondido coast.' },
        { id: 'p_1', whyItMatters: 'Federal infrastructure spending shifts policy direction.' },
      ],
      medicineTech: [{ id: 'm_0', whyItMatters: 'Phase 3 results de-risk an entire therapeutic class.' }],
      genai: [{ id: 'g_0', whyItMatters: 'Practical walkthrough for advanced Claude users.' }],
      dailyBrief: 'Storm hits Oaxaca coast.',
    };
    const out = applyPicks(tagged, parsed, 5);
    expect(out.politics[0].title).toContain('Mexico storm');
    expect(out.politics[0].whyItMatters).toContain('Puerto Escondido');
    expect(out.politics[0]._id).toBeUndefined(); // internal id stripped
    expect(out.dailyBrief).toBe('Storm hits Oaxaca coast.');
  });

  it('drops invalid ids that Claude might invent', () => {
    const tagged = {
      politics: [{ ...sampleCands.politics[0], _id: 'p_0' }],
      medicineTech: [], genai: [],
    };
    const parsed = {
      politics: [{ id: 'p_999', whyItMatters: 'invented' }, { id: 'p_0', whyItMatters: 'real' }],
    };
    const out = applyPicks(tagged, parsed, 5);
    expect(out.politics).toHaveLength(1);
    expect(out.politics[0].whyItMatters).toBe('real');
  });
});

describe('curateAll (mocked SDK client)', () => {
  it('returns ok=false if no API key and no client', async () => {
    const out = await curateAll({ ...sampleCands, env: {} });
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/ANTHROPIC_API_KEY/);
  });

  it('parses a well-formed Claude response and applies picks', async () => {
    const fakeResponse = {
      content: [{ type: 'text', text: `"politics":[{"id":"p_0","whyItMatters":"Affects Puerto Escondido directly."}],
        "medicineTech":[{"id":"m_0","whyItMatters":"Phase 3 trial milestone."}],
        "genai":[{"id":"g_0","whyItMatters":"Tip for advanced MCP users."}],
        "dailyBrief":"Pacific storm makes landfall near Puerto Escondido; Senate passes infrastructure bill."}` }],
      usage: { input_tokens: 1234, output_tokens: 200 },
      model: 'claude-opus-4-5-test',
    };
    const fakeClient = { messages: { create: async () => fakeResponse } };
    const out = await curateAll({ ...sampleCands, client: fakeClient });
    expect(out.ok).toBe(true);
    expect(out.politics[0].title).toContain('Mexico storm');
    expect(out.politics[0].whyItMatters).toContain('Puerto Escondido');
    expect(out.dailyBrief).toContain('Pacific storm');
    expect(out.tokens.input_tokens).toBe(1234);
    expect(out.model).toBe('claude-opus-4-5-test');
  });

  it('returns ok=false if Claude returns malformed JSON', async () => {
    const fakeResponse = { content: [{ type: 'text', text: 'not valid json' }], usage: {}, model: 'x' };
    const fakeClient = { messages: { create: async () => fakeResponse } };
    const out = await curateAll({ ...sampleCands, client: fakeClient });
    expect(out.ok).toBe(false);
  });

  it('returns ok=false if SDK throws', async () => {
    const fakeClient = { messages: { create: async () => { throw new Error('rate limit'); } } };
    const out = await curateAll({ ...sampleCands, client: fakeClient });
    expect(out.ok).toBe(false);
    expect(out.error).toContain('rate limit');
  });

  it('passes prefs and JSON output spec via system prompt', async () => {
    let captured;
    const fakeClient = {
      messages: {
        create: async (args) => {
          captured = args;
          return { content: [{ type: 'text', text: '"politics":[],"medicineTech":[],"genai":[],"dailyBrief":""}' }], usage: {}, model: 'x' };
        },
      },
    };
    await curateAll({ ...sampleCands, client: fakeClient });
    expect(captured.system).toContain('Puerto Escondido');
    expect(captured.system).toContain('NEVER INCLUDE');
    expect(captured.system).toContain('OUTPUT FORMAT');
    // Prefill `{` for reliable JSON output.
    expect(captured.messages.at(-1)).toEqual({ role: 'assistant', content: '{' });
  });
});

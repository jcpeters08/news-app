import { describe, it, expect } from 'vitest';
import { mergePolitics } from '../scripts/build-data.mjs';

describe('mergePolitics', () => {
  it('orders Oaxaca-flagged stories first, then other Mexico, then US', () => {
    const us = [{ title: 'US-1' }, { title: 'US-2' }];
    const mx = [
      { title: 'MX-Generic', isOaxaca: false },
      { title: 'MX-Oaxaca', isOaxaca: true },
      { title: 'MX-PE', isOaxaca: true },
    ];
    const merged = mergePolitics(us, mx);
    expect(merged.map(s => s.title)).toEqual([
      'MX-Oaxaca', 'MX-PE', 'MX-Generic', 'US-1', 'US-2',
    ]);
  });

  it('handles empty Mexico list', () => {
    const us = [{ title: 'US-1' }];
    expect(mergePolitics(us, [])).toEqual(us);
  });

  it('handles empty US list', () => {
    const mx = [{ title: 'MX-1', isOaxaca: false }];
    expect(mergePolitics([], mx)).toEqual(mx);
  });
});

import { describe, it, expect } from 'vitest';
import { chicagoHour, shouldRun } from '../scripts/build-data.mjs';

describe('chicagoHour', () => {
  it('handles CDT (UTC-5) — June noon UTC = 7am Chicago', () => {
    const noonUtcInJune = new Date('2026-06-15T12:00:00Z');
    expect(chicagoHour(noonUtcInJune)).toBe(7);
  });

  it('handles CST (UTC-6) — January noon UTC = 6am Chicago', () => {
    const noonUtcInJan = new Date('2026-01-15T12:00:00Z');
    expect(chicagoHour(noonUtcInJan)).toBe(6);
  });
});

describe('shouldRun (DST-exact gating)', () => {
  it('runs when local hour is exactly 6am CDT (April)', () => {
    // April 25 06:00 CDT = 11:00 UTC
    const t = new Date('2026-04-25T11:00:00Z');
    expect(shouldRun(t, {})).toBe(true);
  });

  it('runs when local hour is exactly 1pm CDT (April)', () => {
    // April 25 13:00 CDT = 18:00 UTC
    const t = new Date('2026-04-25T18:00:00Z');
    expect(shouldRun(t, {})).toBe(true);
  });

  it('runs when local hour is exactly 6am CST (January)', () => {
    // Jan 15 06:00 CST = 12:00 UTC
    const t = new Date('2026-01-15T12:00:00Z');
    expect(shouldRun(t, {})).toBe(true);
  });

  it('runs when local hour is exactly 1pm CST (January)', () => {
    // Jan 15 13:00 CST = 19:00 UTC
    const t = new Date('2026-01-15T19:00:00Z');
    expect(shouldRun(t, {})).toBe(true);
  });

  it('does NOT run at 5am CDT (off-by-one)', () => {
    const t = new Date('2026-04-25T10:00:00Z'); // 5am CDT
    expect(shouldRun(t, {})).toBe(false);
  });

  it('does NOT run at 7am CDT', () => {
    const t = new Date('2026-04-25T12:00:00Z'); // 7am CDT
    expect(shouldRun(t, {})).toBe(false);
  });

  it('does NOT run at 6am UTC outside Chicago window', () => {
    // 06:00 UTC in April = 1am CDT, should not run.
    const t = new Date('2026-04-25T06:00:00Z');
    expect(shouldRun(t, {})).toBe(false);
  });

  it('FORCE_RUN=1 overrides the time gate', () => {
    const t = new Date('2026-04-25T06:00:00Z');
    expect(shouldRun(t, { FORCE_RUN: '1' })).toBe(true);
  });
});

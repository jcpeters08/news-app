import { describe, it, expect } from 'vitest';
import { chicagoHour, shouldRun, recentBuildExists } from '../scripts/build-data.mjs';

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

describe('shouldRun (2-hour windows for cron drift)', () => {
  it('runs at 6am CDT', () => expect(shouldRun(new Date('2026-04-25T11:00:00Z'), {})).toBe(true));
  it('runs at 7am CDT (drift catch)', () => expect(shouldRun(new Date('2026-04-25T12:00:00Z'), {})).toBe(true));
  it('runs at 1pm CDT', () => expect(shouldRun(new Date('2026-04-25T18:00:00Z'), {})).toBe(true));
  it('runs at 2pm CDT (drift catch)', () => expect(shouldRun(new Date('2026-04-25T19:00:00Z'), {})).toBe(true));
  it('runs at 6am CST', () => expect(shouldRun(new Date('2026-01-15T12:00:00Z'), {})).toBe(true));
  it('runs at 7am CST (drift catch)', () => expect(shouldRun(new Date('2026-01-15T13:00:00Z'), {})).toBe(true));
  it('runs at 1pm CST', () => expect(shouldRun(new Date('2026-01-15T19:00:00Z'), {})).toBe(true));
  it('runs at 2pm CST (drift catch)', () => expect(shouldRun(new Date('2026-01-15T20:00:00Z'), {})).toBe(true));

  it('does NOT run at 5am CDT', () => expect(shouldRun(new Date('2026-04-25T10:00:00Z'), {})).toBe(false));
  it('does NOT run at 8am CDT (past window)', () => expect(shouldRun(new Date('2026-04-25T13:00:00Z'), {})).toBe(false));
  it('does NOT run at 12pm CDT (between windows)', () => expect(shouldRun(new Date('2026-04-25T17:00:00Z'), {})).toBe(false));
  it('does NOT run at 3pm CDT (past afternoon window)', () => expect(shouldRun(new Date('2026-04-25T20:00:00Z'), {})).toBe(false));
  it('does NOT run at 1am CDT', () => expect(shouldRun(new Date('2026-04-25T06:00:00Z'), {})).toBe(false));

  it('FORCE_RUN=1 overrides the time gate', () => {
    expect(shouldRun(new Date('2026-04-25T06:00:00Z'), { FORCE_RUN: '1' })).toBe(true);
  });
});

describe('recentBuildExists (idempotency)', () => {
  const now = new Date('2026-04-27T18:00:00Z');

  it('returns true when generatedAt is within 90 min', async () => {
    const fakeFetch = async () => ({
      ok: true,
      json: async () => ({ generatedAt: new Date(now.getTime() - 30 * 60 * 1000).toISOString() }),
    });
    expect(await recentBuildExists({ now, fetchImpl: fakeFetch })).toBe(true);
  });

  it('returns false when generatedAt is older than 90 min', async () => {
    const fakeFetch = async () => ({
      ok: true,
      json: async () => ({ generatedAt: new Date(now.getTime() - 120 * 60 * 1000).toISOString() }),
    });
    expect(await recentBuildExists({ now, fetchImpl: fakeFetch })).toBe(false);
  });

  it('returns false on 404', async () => {
    const fakeFetch = async () => ({ ok: false, status: 404 });
    expect(await recentBuildExists({ now, fetchImpl: fakeFetch })).toBe(false);
  });

  it('returns false on network error (so we still try)', async () => {
    const fakeFetch = async () => { throw new Error('ENETUNREACH'); };
    expect(await recentBuildExists({ now, fetchImpl: fakeFetch })).toBe(false);
  });

  it('returns false on malformed generatedAt', async () => {
    const fakeFetch = async () => ({ ok: true, json: async () => ({ generatedAt: 'not-a-date' }) });
    expect(await recentBuildExists({ now, fetchImpl: fakeFetch })).toBe(false);
  });
});

import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformWeather, weatherCodeToText, weatherCodeToIcon, fetchWeather, fetchTides, detectTides, uvLevel, uvLabel, CITIES } from '../scripts/fetch-weather.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('weatherCodeToText', () => {
  it('maps known codes', () => {
    expect(weatherCodeToText(0)).toBe('Clear');
    expect(weatherCodeToText(95)).toBe('Thunderstorm');
  });
  it('returns Unknown for null or unknown codes', () => {
    expect(weatherCodeToText(null)).toBe('Unknown');
    expect(weatherCodeToText(999)).toBe('Unknown');
  });
});

describe('weatherCodeToIcon', () => {
  it('returns sun in day, moon at night for clear', () => {
    expect(weatherCodeToIcon(0, true)).toBe('☀️');
    expect(weatherCodeToIcon(0, false)).toBe('🌙');
  });
});

describe('transformWeather', () => {
  it('rounds temps and maps current fields', async () => {
    const raw = JSON.parse(await fs.readFile(path.join(__dirname, 'fixtures', 'openmeteo-mpls.json'), 'utf8'));
    const out = transformWeather(raw, CITIES[0]);
    expect(out.cityId).toBe('minneapolis');
    expect(out.current.tempF).toBe(62);
    expect(out.current.condition).toBe('Partly cloudy');
    expect(out.today.highF).toBe(68);
    expect(out.today.lowF).toBe(45);
    expect(out.today.precipChance).toBe(10);
  });

  it('returns 7 days in forecast array', async () => {
    const raw = JSON.parse(await fs.readFile(path.join(__dirname, 'fixtures', 'openmeteo-mpls.json'), 'utf8'));
    const out = transformWeather(raw, CITIES[0]);
    expect(out.forecast).toHaveLength(7);
    expect(out.forecast[0].date).toBe('2026-04-25');
    expect(out.forecast[6].date).toBe('2026-05-01');
  });

  it('attaches day-of-week labels and per-day icons', async () => {
    const raw = JSON.parse(await fs.readFile(path.join(__dirname, 'fixtures', 'openmeteo-mpls.json'), 'utf8'));
    const out = transformWeather(raw, CITIES[0]);
    // 2026-04-25 is a Saturday
    expect(out.forecast[0].dow).toBe('Sat');
    expect(out.forecast[1].dow).toBe('Sun');
    // weather_code[5] is 95 (thunderstorm)
    expect(out.forecast[5].condition).toBe('Thunderstorm');
    expect(out.forecast[5].icon).toBe('⛈️');
  });

  it('today is alias of forecast[0]', async () => {
    const raw = JSON.parse(await fs.readFile(path.join(__dirname, 'fixtures', 'openmeteo-mpls.json'), 'utf8'));
    const out = transformWeather(raw, CITIES[0]);
    expect(out.today).toEqual(out.forecast[0]);
  });
});

describe('CITIES', () => {
  it('includes Minneapolis, Mexico City, and Puerto Escondido', () => {
    const ids = CITIES.map(c => c.id);
    expect(ids).toEqual(['minneapolis', 'mexico_city', 'puerto_escondido']);
  });
  it('uses correct IANA timezones', () => {
    const byId = Object.fromEntries(CITIES.map(c => [c.id, c]));
    expect(byId.minneapolis.timezone).toBe('America/Chicago');
    expect(byId.mexico_city.timezone).toBe('America/Mexico_City');
    expect(byId.puerto_escondido.timezone).toBe('America/Mexico_City');
  });
});

describe('uvLevel + uvLabel', () => {
  it('bands UV per WHO scale', () => {
    expect(uvLevel(0)).toBe('low');
    expect(uvLevel(2.9)).toBe('low');
    expect(uvLevel(3)).toBe('moderate');
    expect(uvLevel(5.9)).toBe('moderate');
    expect(uvLevel(6)).toBe('high');
    expect(uvLevel(7.9)).toBe('high');
    expect(uvLevel(8)).toBe('very-high');
    expect(uvLevel(10.9)).toBe('very-high');
    expect(uvLevel(11)).toBe('extreme');
    expect(uvLevel(15)).toBe('extreme');
    expect(uvLevel(null)).toBe(null);
  });
  it('labels match the scale', () => {
    expect(uvLabel(2)).toBe('Low');
    expect(uvLabel(11)).toBe('Extreme');
  });
});

describe('transformWeather attaches UV', () => {
  it('returns uv.max + level + label', async () => {
    const raw = JSON.parse(await fs.readFile(path.join(__dirname, 'fixtures', 'openmeteo-mpls.json'), 'utf8'));
    raw.daily.uv_index_max = [9.4, 8, 7, 5, 4, 3, 2];
    raw.current.uv_index = 6.2;
    const out = transformWeather(raw, CITIES[0]);
    expect(out.uv.max).toBe(9.4);
    expect(out.uv.level).toBe('very-high');
    expect(out.uv.label).toBe('Very High');
    expect(out.current.uv).toBe(6.2);
    expect(out.forecast[0].uvMax).toBe(9.4);
    expect(out.forecast[6].uvMax).toBe(2);
  });

  it('uv is null if not provided', async () => {
    const raw = JSON.parse(await fs.readFile(path.join(__dirname, 'fixtures', 'openmeteo-mpls.json'), 'utf8'));
    const out = transformWeather(raw, CITIES[0]);
    expect(out.uv).toBe(null);
  });

  it('attaches tides when passed', async () => {
    const raw = JSON.parse(await fs.readFile(path.join(__dirname, 'fixtures', 'openmeteo-mpls.json'), 'utf8'));
    const tides = [
      { type: 'H', date: '2026-04-25', time: '03:00', timeLabel: '3:00 AM', heightFt: 4.8, heightM: 1.46 },
      { type: 'L', date: '2026-04-25', time: '09:00', timeLabel: '9:00 AM', heightFt: 1.1, heightM: 0.34 },
    ];
    const out = transformWeather(raw, CITIES[2], { tides });
    expect(out.tides).toEqual(tides);
  });
});

describe('detectTides', () => {
  // Coastal city in Chicago timezone for fixture stability.
  const city = { id: 'pe', timezone: 'America/Chicago' };

  it('finds local maxima as H and minima as L, only on today', () => {
    // Fake "today" so today's date in Chicago is 2026-04-25
    const now = new Date('2026-04-25T18:00:00Z'); // 1pm CDT
    const json = {
      hourly: {
        time: [
          '2026-04-25T00:00','2026-04-25T01:00','2026-04-25T02:00','2026-04-25T03:00','2026-04-25T04:00',
          '2026-04-25T05:00','2026-04-25T06:00','2026-04-25T07:00','2026-04-25T08:00','2026-04-25T09:00',
        ],
        sea_level_height_msl: [
          0.5, 0.8, 1.2, 1.5, 1.4, // peak at idx 3
          0.9, 0.4, 0.2, 0.4, 0.8, // trough at idx 7
        ],
      },
    };
    const out = detectTides(json, city, now);
    expect(out.length).toBe(2);
    expect(out[0]).toMatchObject({ type: 'H', time: '03:00' });
    expect(out[0].heightFt).toBeCloseTo(1.5 * 3.28084, 1);
    expect(out[1]).toMatchObject({ type: 'L', time: '07:00' });
  });

  it('filters out events from a different day', () => {
    const now = new Date('2026-04-25T18:00:00Z');
    const json = {
      hourly: {
        time: ['2026-04-26T02:00', '2026-04-26T03:00', '2026-04-26T04:00'],
        sea_level_height_msl: [0.5, 1.5, 0.5],
      },
    };
    expect(detectTides(json, city, now)).toEqual([]);
  });
});

describe('fetchWeather (mocked)', () => {
  it('builds correct URL with timezone, units, and 7-day forecast', async () => {
    let calledUrl;
    const raw = JSON.parse(await fs.readFile(path.join(__dirname, 'fixtures', 'openmeteo-mpls.json'), 'utf8'));
    const fakeFetch = async (url) => {
      calledUrl = url;
      return { ok: true, json: async () => raw };
    };
    await fetchWeather({ city: CITIES[0], fetchImpl: fakeFetch });
    expect(calledUrl).toContain('open-meteo.com');
    expect(calledUrl).toContain('temperature_unit=fahrenheit');
    expect(calledUrl).toContain('timezone=America%2FChicago');
    expect(calledUrl).toContain('forecast_days=7');
  });
});

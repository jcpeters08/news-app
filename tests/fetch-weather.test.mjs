import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformWeather, weatherCodeToText, weatherCodeToIcon, fetchWeather, CITIES } from '../scripts/fetch-weather.mjs';

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
  it('rounds temps and maps fields', async () => {
    const raw = JSON.parse(await fs.readFile(path.join(__dirname, 'fixtures', 'openmeteo-mpls.json'), 'utf8'));
    const out = transformWeather(raw, CITIES[0]);
    expect(out.cityId).toBe('minneapolis');
    expect(out.current.tempF).toBe(62);
    expect(out.current.condition).toBe('Partly cloudy');
    expect(out.today.highF).toBe(68);
    expect(out.today.lowF).toBe(45);
    expect(out.today.precipChance).toBe(10);
  });
});

describe('fetchWeather (mocked)', () => {
  it('builds correct URL with timezone and units', async () => {
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
  });
});

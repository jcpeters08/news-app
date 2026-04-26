// Open-Meteo: free, no API key. Docs: https://open-meteo.com/en/docs

export const CITIES = [
  {
    id: 'minneapolis',
    name: 'Minneapolis',
    lat: 44.9778,
    lon: -93.2650,
    timezone: 'America/Chicago',
    coastal: false,
  },
  {
    id: 'mexico_city',
    name: 'Mexico City',
    lat: 19.4326,
    lon: -99.1332,
    timezone: 'America/Mexico_City',
    coastal: false,
  },
  {
    id: 'puerto_escondido',
    name: 'Puerto Escondido',
    lat: 15.8720,
    lon: -97.0767,
    timezone: 'America/Mexico_City',
    coastal: true, // tides fetched via Open-Meteo Marine API
  },
];

const FORECAST_DAYS = 7;

export async function fetchWeather({ city, fetchImpl = fetch }) {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(city.lat));
  url.searchParams.set('longitude', String(city.lon));
  url.searchParams.set('current', 'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m,uv_index');
  url.searchParams.set('daily', 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset,uv_index_max');
  url.searchParams.set('temperature_unit', 'fahrenheit');
  url.searchParams.set('wind_speed_unit', 'mph');
  url.searchParams.set('precipitation_unit', 'inch');
  url.searchParams.set('timezone', city.timezone);
  url.searchParams.set('forecast_days', String(FORECAST_DAYS));

  const res = await fetchImpl(url.toString());
  if (!res.ok) throw new Error(`Open-Meteo ${city.id} failed: ${res.status}`);
  const json = await res.json();

  // Coastal cities also pull hourly sea-level height for tide detection.
  let tides = null;
  if (city.coastal) {
    try {
      tides = await fetchTides({ city, fetchImpl });
    } catch (e) {
      console.error(`Tides ${city.id} error:`, e.message);
    }
  }

  return transformWeather(json, city, { tides });
}

// Open-Meteo Marine API. Hourly sea_level_height_msl in meters → we detect
// peaks (highs) and troughs (lows) and convert to feet for display.
export async function fetchTides({ city, fetchImpl = fetch, now = new Date() }) {
  const url = new URL('https://marine-api.open-meteo.com/v1/marine');
  url.searchParams.set('latitude', String(city.lat));
  url.searchParams.set('longitude', String(city.lon));
  url.searchParams.set('hourly', 'sea_level_height_msl');
  url.searchParams.set('timezone', city.timezone);
  url.searchParams.set('forecast_days', '2'); // 48h so we don't miss late-day tides

  const res = await fetchImpl(url.toString());
  if (!res.ok) throw new Error(`Marine ${city.id} failed: ${res.status}`);
  const json = await res.json();
  return detectTides(json, city, now);
}

// Detect local maxima (high tide) and minima (low tide) in the hourly array.
// Returns only events that fall on "today" in the city's timezone.
export function detectTides(json, city, now = new Date()) {
  const times = json?.hourly?.time || [];
  const heights = json?.hourly?.sea_level_height_msl || [];
  if (!times.length || !heights.length) return [];

  const todayISO = todayInTimezone(now, city.timezone);
  const events = [];
  for (let i = 1; i < heights.length - 1; i++) {
    const a = heights[i - 1], b = heights[i], c = heights[i + 1];
    if (a == null || b == null || c == null) continue;
    if (b > a && b > c) events.push(makeTide('H', times[i], b));
    else if (b < a && b < c) events.push(makeTide('L', times[i], b));
  }
  return events.filter(e => e.date === todayISO);
}

function makeTide(type, isoLocal, meters) {
  // isoLocal is "YYYY-MM-DDTHH:MM" already in city's local TZ.
  const [date, hm] = isoLocal.split('T');
  const heightFt = Math.round(meters * 3.28084 * 10) / 10;
  return {
    type,                 // 'H' or 'L'
    date,                 // local date YYYY-MM-DD
    time: hm,             // local time HH:MM (24h)
    timeLabel: format12h(hm),
    heightFt,
    heightM: Math.round(meters * 100) / 100,
  };
}

function format12h(hm) {
  const [h, m] = hm.split(':').map(Number);
  const pm = h >= 12;
  const h12 = ((h % 12) || 12);
  return `${h12}:${String(m).padStart(2, '0')} ${pm ? 'PM' : 'AM'}`;
}

function todayInTimezone(now, tz) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  return fmt.format(now); // 'YYYY-MM-DD'
}

export function transformWeather(json, city, { tides = null } = {}) {
  const cur = json.current || {};
  const d = json.daily || {};
  const days = (d.time || []).map((dateStr, i) => ({
    date: dateStr,
    dow: dayOfWeek(dateStr, city.timezone),
    highF: round(d.temperature_2m_max?.[i]),
    lowF: round(d.temperature_2m_min?.[i]),
    precipChance: d.precipitation_probability_max?.[i] ?? null,
    code: d.weather_code?.[i] ?? null,
    condition: weatherCodeToText(d.weather_code?.[i]),
    icon: weatherCodeToIcon(d.weather_code?.[i], true),
    sunrise: d.sunrise?.[i] || null,
    sunset: d.sunset?.[i] || null,
    uvMax: roundOne(d.uv_index_max?.[i]),
  }));
  const todayUv = roundOne(d.uv_index_max?.[0]);
  return {
    cityId: city.id,
    cityName: city.name,
    timezone: city.timezone,
    current: {
      tempF: round(cur.temperature_2m),
      apparentF: round(cur.apparent_temperature),
      humidity: cur.relative_humidity_2m ?? null,
      precipitationIn: cur.precipitation ?? null,
      windMph: round(cur.wind_speed_10m),
      isDay: cur.is_day === 1,
      condition: weatherCodeToText(cur.weather_code),
      icon: weatherCodeToIcon(cur.weather_code, cur.is_day === 1),
      uv: roundOne(cur.uv_index),
    },
    uv: todayUv != null ? {
      max: todayUv,
      level: uvLevel(todayUv),    // 'low' | 'moderate' | 'high' | 'very-high' | 'extreme'
      label: uvLabel(todayUv),    // human label
    } : null,
    tides: tides && tides.length ? tides : null,
    today: days[0] || null,
    forecast: days, // index 0 = today, 1..6 = next 6 days
  };
}

function roundOne(n) {
  if (n == null || !Number.isFinite(n)) return null;
  return Math.round(n * 10) / 10;
}

// WHO UV index banding.
export function uvLevel(uv) {
  if (uv == null) return null;
  if (uv < 3) return 'low';
  if (uv < 6) return 'moderate';
  if (uv < 8) return 'high';
  if (uv < 11) return 'very-high';
  return 'extreme';
}
export function uvLabel(uv) {
  const map = { low: 'Low', moderate: 'Moderate', high: 'High', 'very-high': 'Very High', extreme: 'Extreme' };
  return map[uvLevel(uv)] || '';
}

function dayOfWeek(dateStr, timezone) {
  // dateStr from Open-Meteo daily is "YYYY-MM-DD" already in city's timezone.
  // Use UTC noon to avoid edge cases when converting to a Date object.
  const d = new Date(dateStr + 'T12:00:00Z');
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' }).format(d);
}

function round(n) {
  if (n == null || !Number.isFinite(n)) return null;
  return Math.round(n);
}

// WMO Weather Code mapping. https://open-meteo.com/en/docs
export function weatherCodeToText(code) {
  if (code == null) return 'Unknown';
  const map = {
    0: 'Clear',
    1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Overcast',
    45: 'Fog', 48: 'Rime fog',
    51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle',
    56: 'Freezing drizzle', 57: 'Heavy freezing drizzle',
    61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
    66: 'Freezing rain', 67: 'Heavy freezing rain',
    71: 'Light snow', 73: 'Snow', 75: 'Heavy snow',
    77: 'Snow grains',
    80: 'Light showers', 81: 'Showers', 82: 'Heavy showers',
    85: 'Snow showers', 86: 'Heavy snow showers',
    95: 'Thunderstorm', 96: 'Thunderstorm w/ hail', 99: 'Severe thunderstorm',
  };
  return map[code] || 'Unknown';
}

export function weatherCodeToIcon(code, isDay = true) {
  if (code == null) return '❓';
  if (code === 0) return isDay ? '☀️' : '🌙';
  if (code <= 2) return isDay ? '🌤️' : '🌙';
  if (code === 3) return '☁️';
  if (code <= 48) return '🌫️';
  if (code <= 57) return '🌦️';
  if (code <= 67) return '🌧️';
  if (code <= 77) return '🌨️';
  if (code <= 82) return '🌧️';
  if (code <= 86) return '🌨️';
  if (code >= 95) return '⛈️';
  return '☁️';
}

// Open-Meteo: free, no API key. Docs: https://open-meteo.com/en/docs

export const CITIES = [
  {
    id: 'minneapolis',
    name: 'Minneapolis',
    lat: 44.9778,
    lon: -93.2650,
    timezone: 'America/Chicago',
  },
  {
    id: 'mexico_city',
    name: 'Mexico City',
    lat: 19.4326,
    lon: -99.1332,
    timezone: 'America/Mexico_City',
  },
  {
    id: 'puerto_escondido',
    name: 'Puerto Escondido',
    lat: 15.8720,
    lon: -97.0767,
    timezone: 'America/Mexico_City',
  },
];

const FORECAST_DAYS = 7;

export async function fetchWeather({ city, fetchImpl = fetch }) {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(city.lat));
  url.searchParams.set('longitude', String(city.lon));
  url.searchParams.set('current', 'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m');
  url.searchParams.set('daily', 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset');
  url.searchParams.set('temperature_unit', 'fahrenheit');
  url.searchParams.set('wind_speed_unit', 'mph');
  url.searchParams.set('precipitation_unit', 'inch');
  url.searchParams.set('timezone', city.timezone);
  url.searchParams.set('forecast_days', String(FORECAST_DAYS));

  const res = await fetchImpl(url.toString());
  if (!res.ok) throw new Error(`Open-Meteo ${city.id} failed: ${res.status}`);
  const json = await res.json();
  return transformWeather(json, city);
}

export function transformWeather(json, city) {
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
  }));
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
    },
    today: days[0] || null,
    forecast: days, // index 0 = today, 1..6 = next 6 days
  };
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

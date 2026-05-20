// OpenWeatherMap forecast lookup for match weather context.
//
// City comes from fixture.fixture.venue.city on the API-Football response,
// so we don't need a hardcoded stadium map. Returns null cleanly when
// OPENWEATHER_API_KEY isn't set.

const axios = require('axios');

const FORECAST_URL = 'https://api.openweathermap.org/data/2.5/forecast';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour per city
const cache = new Map(); // city -> { value, expires }

function isConfigured() {
  return !!process.env.OPENWEATHER_API_KEY;
}

// Find the forecast slot closest to the kickoff time.
function pickClosestSlot(list, kickoffMs) {
  if (!Array.isArray(list) || list.length === 0) return null;
  let best = list[0];
  let bestDist = Math.abs(new Date(list[0].dt * 1000).getTime() - kickoffMs);
  for (const slot of list) {
    const d = Math.abs(new Date(slot.dt * 1000).getTime() - kickoffMs);
    if (d < bestDist) {
      best = slot;
      bestDist = d;
    }
  }
  return best;
}

function shapeSlot(slot) {
  if (!slot) return null;
  const main = slot.main || {};
  const w = (slot.weather && slot.weather[0]) || {};
  const wind = slot.wind || {};
  const rain = (slot.rain && (slot.rain['3h'] || slot.rain['1h'])) || 0;
  const snow = (slot.snow && (slot.snow['3h'] || slot.snow['1h'])) || 0;
  return {
    temp: typeof main.temp === 'number' ? Math.round(main.temp) : null,
    feelsLike: typeof main.feels_like === 'number' ? Math.round(main.feels_like) : null,
    humidity: typeof main.humidity === 'number' ? main.humidity : null,
    condition: w.main || null,
    description: w.description || null,
    icon: w.icon || null,
    windSpeed: typeof wind.speed === 'number' ? Math.round(wind.speed * 3.6) : null, // m/s → km/h
    precipitation: Math.round((rain + snow) * 10) / 10, // mm
    forecastTime: slot.dt ? new Date(slot.dt * 1000).toISOString() : null,
  };
}

async function fetchCity(city) {
  const res = await axios.get(FORECAST_URL, {
    params: {
      q: city,
      appid: process.env.OPENWEATHER_API_KEY,
      units: 'metric',
    },
    timeout: 8000,
    validateStatus: () => true,
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error(`OpenWeatherMap auth failed (${res.status})`);
  }
  if (res.status === 429) {
    throw new Error('OpenWeatherMap rate limit hit');
  }
  if (res.status >= 400) {
    // 404 = city not found; treat as soft failure.
    return null;
  }
  return res.data && Array.isArray(res.data.list) ? res.data.list : null;
}

async function getMatchWeather(city, kickoffIso) {
  if (!isConfigured()) return null;
  if (!city || !kickoffIso) return null;

  const kickoffMs = new Date(kickoffIso).getTime();
  if (Number.isNaN(kickoffMs)) return null;

  // Forecast extends ~5 days. If the match is further out we can't get it.
  if (kickoffMs - Date.now() > 5 * 24 * 60 * 60 * 1000) return null;

  const cacheKey = city.toLowerCase();
  const cached = cache.get(cacheKey);
  let list;
  if (cached && cached.expires > Date.now()) {
    list = cached.value;
  } else {
    try {
      list = await fetchCity(city);
      if (list) cache.set(cacheKey, { value: list, expires: Date.now() + CACHE_TTL_MS });
    } catch (err) {
      console.error(`[weather] ${city} fetch failed:`, err.message);
      return null;
    }
  }
  if (!list) return null;

  const slot = pickClosestSlot(list, kickoffMs);
  const shaped = shapeSlot(slot);
  if (!shaped) return null;

  // Pre-compute warnings — used both by the AI prompt and the UI.
  const warnings = [];
  if (shaped.precipitation > 5) warnings.push('HEAVY_RAIN');
  if (shaped.windSpeed > 40) warnings.push('STRONG_WIND');
  if (shaped.temp != null && shaped.temp > 32) warnings.push('EXTREME_HEAT');
  if (shaped.temp != null && shaped.temp < 2) warnings.push('COLD');
  return { ...shaped, city, warnings };
}

module.exports = { isConfigured, getMatchWeather };

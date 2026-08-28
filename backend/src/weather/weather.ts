/**
 * Live weather, from Open-Meteo.
 *
 * The one surface in this application whose data is not an approved organizational
 * record. Everything else (flights, hotels, plans, bookings) is read from our own
 * data and can be traced to a session/user; this is fetched from a third party at
 * request time and cannot. The frontend card says so rather than letting it sit
 * alongside governed data looking equally authoritative — which is the honest way
 * to mix a public feed into the rest of the app.
 *
 * Open-Meteo needs no API key, which is why it is used here: no credential to
 * distribute with a demo.
 */

const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';

/** A slow third party shouldn't be able to hang a request indefinitely. */
const REQUEST_TIMEOUT_MS = 6000;

export type ResolvedPlace = {
  name: string;
  country: string;
  admin?: string;
  latitude: number;
  longitude: number;
  timezone: string;
};

export type WeatherReading = {
  place: string;
  temperatureC: number;
  feelsLikeC: number;
  humidityPercent: number;
  windKph: number;
  condition: string;
  isDay: boolean;
  observedAt: string;
  timezone: string;
  /** Named so the surface can attribute it; this is not an approved record. */
  provider: string;
  daily: { date: string; minC: number; maxC: number; condition: string }[];
};

/**
 * WMO weather interpretation codes.
 *
 * Open-Meteo returns a numeric code rather than a description, so the mapping has to
 * live somewhere; keeping it beside the fetch means the component renders a string it
 * does not have to interpret.
 */
const WMO_CONDITIONS: Record<number, string> = {
  0: 'Clear sky',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Depositing rime fog',
  51: 'Light drizzle',
  53: 'Moderate drizzle',
  55: 'Dense drizzle',
  56: 'Light freezing drizzle',
  57: 'Dense freezing drizzle',
  61: 'Slight rain',
  63: 'Moderate rain',
  65: 'Heavy rain',
  66: 'Light freezing rain',
  67: 'Heavy freezing rain',
  71: 'Slight snowfall',
  73: 'Moderate snowfall',
  75: 'Heavy snowfall',
  77: 'Snow grains',
  80: 'Slight rain showers',
  81: 'Moderate rain showers',
  82: 'Violent rain showers',
  85: 'Slight snow showers',
  86: 'Heavy snow showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm with slight hail',
  99: 'Thunderstorm with heavy hail',
};

/**
 * Open-Meteo's geocoder is GeoNames-derived and ranks by population, which
 * mis-resolves a couple of this app's own destination names: "Goa" (the
 * Indian tourist state — the geocoder has no good entry for it at all, and
 * ranks Genoa, Italy above the small villages named Goa), "Manali" (a
 * Chennai suburb outranks the Himachal Pradesh hill station every one of
 * this app's example queries actually means), and "Kerala" (matches a
 * village called Kerälä in Finland by exact name before any Indian result).
 * Checked before hitting the API; add to this table as other mismatches turn
 * up rather than living with a live lookup that's confidently wrong.
 */
const KNOWN_PLACE_OVERRIDES: Record<string, ResolvedPlace> = {
  kerala: {
    name: 'Kerala', country: 'India', admin: 'Kerala',
    latitude: 9.9312, longitude: 76.2673, timezone: 'Asia/Kolkata',
  },
  goa: {
    name: 'Goa', country: 'India', admin: 'Goa',
    latitude: 15.4909, longitude: 73.8278, timezone: 'Asia/Kolkata',
  },
  manali: {
    name: 'Manali', country: 'India', admin: 'Himachal Pradesh',
    latitude: 32.2574, longitude: 77.17481, timezone: 'Asia/Kolkata',
  },
};

function conditionFor(code: unknown): string {
  return typeof code === 'number' ? (WMO_CONDITIONS[code] ?? `Code ${code}`) : 'Unknown';
}

/** Fetch with a timeout, so a slow third party cannot hang a run indefinitely. */
async function fetchJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Weather provider returned ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

/** GeoNames feature codes for whole countries/political entities (PCLI,
 * PCLD, PCLF, PCLS, PCLIX, PCL itself) — a weather reading for "India" as a
 * single point is meaningless, so a match at this level is treated as no
 * match at all rather than shown as if it were a real destination. */
function isCountryLevel(match: Record<string, unknown>): boolean {
  const code = String(match.feature_code ?? '');
  if (code.startsWith('PCL')) return true;
  return String(match.name ?? '').toLowerCase() === String(match.country ?? '').toLowerCase();
}

export async function resolvePlace(query: string): Promise<ResolvedPlace | undefined> {
  const override = KNOWN_PLACE_OVERRIDES[query.trim().toLowerCase()];
  if (override) return override;

  const url = `${GEOCODE_URL}?name=${encodeURIComponent(query)}&count=5&language=en&format=json`;
  const payload = (await fetchJson(url)) as { results?: Record<string, unknown>[] };
  const match = (payload.results ?? []).find((m) => !isCountryLevel(m));
  if (!match) return undefined;

  return {
    name: String(match.name ?? query),
    country: String(match.country ?? ''),
    admin: match.admin1 ? String(match.admin1) : undefined,
    latitude: Number(match.latitude),
    longitude: Number(match.longitude),
    timezone: String(match.timezone ?? 'auto'),
  };
}

export async function loadWeather(query: string): Promise<WeatherReading | undefined> {
  const place = await resolvePlace(query);
  if (!place) return undefined;

  const url =
    `${FORECAST_URL}?latitude=${place.latitude}&longitude=${place.longitude}` +
    '&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,wind_speed_10m' +
    '&daily=weather_code,temperature_2m_max,temperature_2m_min&forecast_days=4&timezone=auto';

  const payload = (await fetchJson(url)) as {
    current?: Record<string, unknown>;
    daily?: Record<string, unknown[]>;
  };
  const current = payload.current;
  if (!current) return undefined;

  const daily = payload.daily ?? {};
  const dates = (daily.time ?? []) as string[];

  return {
    // Dedupe repeated parts — for a place that is its own admin region
    // (Goa, Kerala) name and admin are identical and would render "Goa, Goa,
    // India" without this.
    place: [place.name, place.admin, place.country]
      .filter(Boolean)
      .filter((part, i, parts) => parts.findIndex((p) => p!.toLowerCase() === part!.toLowerCase()) === i)
      .join(', '),
    temperatureC: Number(current.temperature_2m),
    feelsLikeC: Number(current.apparent_temperature),
    humidityPercent: Number(current.relative_humidity_2m),
    windKph: Number(current.wind_speed_10m),
    condition: conditionFor(current.weather_code),
    isDay: current.is_day === 1,
    observedAt: String(current.time ?? ''),
    timezone: place.timezone,
    provider: 'Open-Meteo',
    daily: dates.map((date, index) => ({
      date,
      minC: Number((daily.temperature_2m_min ?? [])[index]),
      maxC: Number((daily.temperature_2m_max ?? [])[index]),
      condition: conditionFor((daily.weather_code ?? [])[index]),
    })),
  };
}

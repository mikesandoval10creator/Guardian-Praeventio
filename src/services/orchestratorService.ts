import { WeatherData, SeismicData, EnvironmentContext } from '../types';
import { logger } from '../utils/logger';

const OPENWEATHER_API_KEY = import.meta.env.VITE_OPENWEATHER_API_KEY;

// Default coordinates (Santiago, Chile) if none provided
const DEFAULT_LAT = -33.4489;
const DEFAULT_LON = -70.6693;

/** WMO weather-code → es-CL condition text (Open-Meteo `weather_code`). */
const WMO_CONDITION_ES: Record<number, string> = {
  0: 'Despejado',
  1: 'Mayormente despejado',
  2: 'Parcialmente nublado',
  3: 'Nublado',
  45: 'Niebla',
  48: 'Niebla con escarcha',
  51: 'Llovizna ligera',
  53: 'Llovizna',
  55: 'Llovizna intensa',
  56: 'Llovizna helada',
  57: 'Llovizna helada intensa',
  61: 'Lluvia ligera',
  63: 'Lluvia',
  65: 'Lluvia intensa',
  66: 'Lluvia helada',
  67: 'Lluvia helada intensa',
  71: 'Nieve ligera',
  73: 'Nieve',
  75: 'Nieve intensa',
  77: 'Granos de nieve',
  80: 'Chubascos ligeros',
  81: 'Chubascos',
  82: 'Chubascos violentos',
  85: 'Chubascos de nieve',
  86: 'Chubascos de nieve intensos',
  95: 'Tormenta eléctrica',
  96: 'Tormenta con granizo',
  99: 'Tormenta con granizo intenso',
};

interface MeteoReading {
  temp: number;
  condition: string;
  humidity: number;
  /** REAL UV index from Open-Meteo (`uv_index`), or null if the field is absent. */
  uv: number | null;
  windKmh: number;
  sunrise?: number;
  sunset?: number;
}

/**
 * REAL weather from Open-Meteo — keyless, CORS-enabled, and (crucially) it
 * returns a measured `uv_index`. This is the primary measurement source: the
 * app no longer needs an OpenWeather key to show real temperature/humidity/
 * wind/UV. Returns null only when the API is unreachable at runtime.
 */
async function fetchOpenMeteoWeather(lat: number, lon: number): Promise<MeteoReading | null> {
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,relative_humidity_2m,wind_speed_10m,uv_index,weather_code` +
      `&daily=sunrise,sunset&wind_speed_unit=kmh&timezone=auto&forecast_days=1`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = await res.json();
    const c = json?.current;
    if (!c || typeof c.temperature_2m !== 'number') return null;
    const code = typeof c.weather_code === 'number' ? c.weather_code : -1;
    const sr = json?.daily?.sunrise?.[0];
    const ss = json?.daily?.sunset?.[0];
    return {
      temp: Math.round(c.temperature_2m),
      condition: WMO_CONDITION_ES[code] ?? 'Despejado',
      humidity: Math.round(c.relative_humidity_2m ?? 0),
      uv: typeof c.uv_index === 'number' ? Math.round(c.uv_index * 10) / 10 : null,
      windKmh: Math.round((c.wind_speed_10m ?? 0) * 10) / 10,
      sunrise: typeof sr === 'string' ? Date.parse(sr) : undefined,
      sunset: typeof ss === 'string' ? Date.parse(ss) : undefined,
    };
  } catch {
    return null;
  }
}

interface OpenWeatherEnhance {
  temp: number;
  condition: string;
  humidity: number;
  location: string | null;
  windSpeed: number;
  sunrise?: number;
  sunset?: number;
}

/**
 * Optional ENHANCER: OpenWeather adds a reverse-geocoded city name + a
 * localized condition string + sunrise/sunset. Only used when a key is
 * present; the real measurements (incl. UV) come from Open-Meteo. Doubles as
 * a full fallback reading if Open-Meteo is unreachable. Returns null when the
 * key is missing or the request fails (never fabricates).
 */
async function fetchOpenWeatherEnhance(lat: number, lon: number): Promise<OpenWeatherEnhance | null> {
  if (!OPENWEATHER_API_KEY) return null;
  try {
    const response = await fetch(
      `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${OPENWEATHER_API_KEY}&units=metric&lang=es`,
    );
    if (!response.ok) return null;
    const data = await response.json();
    if (typeof data?.main?.temp !== 'number') return null;
    return {
      temp: Math.round(data.main.temp),
      condition: data.weather?.[0]?.description || 'Despejado',
      humidity: data.main.humidity,
      location: typeof data.name === 'string' && data.name.length > 0 ? data.name : null,
      windSpeed: (data.wind?.speed ?? 0) * 3.6, // m/s → km/h
      sunrise: typeof data.sys?.sunrise === 'number' ? data.sys.sunrise * 1000 : undefined,
      sunset: typeof data.sys?.sunset === 'number' ? data.sys.sunset * 1000 : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Fetches REAL weather. Open-Meteo (keyless) is the measurement source and
 * provides the real UV index; OpenWeather (when keyed) only enhances the city
 * name + localized condition + AQI. Weather works without any API key. We fall
 * back to the honest `unavailable: true` payload ONLY when BOTH real sources
 * are unreachable at runtime — never to fabricated numbers.
 */
export const fetchWeatherData = async (
  lat: number = DEFAULT_LAT,
  lon: number = DEFAULT_LON,
): Promise<WeatherData> => {
  const [meteo, ow, airQuality] = await Promise.all([
    fetchOpenMeteoWeather(lat, lon),
    fetchOpenWeatherEnhance(lat, lon),
    fetchAirQualityLabel(lat, lon),
  ]);

  if (!meteo && !ow) {
    // Both real sources unreachable at this moment → honest empty state.
    return getMockWeatherData();
  }

  // Prefer Open-Meteo's measurements (real UV); OpenWeather fills the city
  // name / localized condition and serves as a full reading if OM is down.
  const temp = meteo?.temp ?? ow!.temp;
  const windSpeed = meteo?.windKmh ?? ow!.windSpeed;
  return {
    temp,
    condition: ow?.condition ?? meteo!.condition,
    humidity: meteo?.humidity ?? ow!.humidity,
    uv: meteo?.uv ?? null, // REAL UV from Open-Meteo (null only if OM unreachable)
    airQuality, // real AQI label or null (never fabricated)
    altitude: null, // requires a separate elevation API — not wired; null = truth
    location: ow?.location ?? null,
    windSpeed,
    recommendations: generateWeatherRecommendations(temp, windSpeed ?? 0),
    sunrise: meteo?.sunrise ?? ow?.sunrise,
    sunset: meteo?.sunset ?? ow?.sunset,
  };
};

/**
 * Fetches recent seismic data from USGS Earthquake Catalog.
 * Returns the most significant recent earthquake within a radius.
 */
export const fetchSeismicData = async (lat: number = DEFAULT_LAT, lon: number = DEFAULT_LON, radiusKm: number = 500): Promise<SeismicData | null> => {
  try {
    // Look for earthquakes in the last 24 hours
    const endTime = new Date().toISOString();
    const startTime = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    
    const response = await fetch(
      `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&latitude=${lat}&longitude=${lon}&maxradiuskm=${radiusKm}&starttime=${startTime}&minmagnitude=3.0&limit=1&orderby=magnitude`
    );

    if (!response.ok) {
      throw new Error(`Seismic API error: ${response.statusText}`);
    }

    const data = await response.json();

    if (data.features && data.features.length > 0) {
      const quake = data.features[0];
      const mag = quake.properties.mag;
      
      let alertLevel: 'green' | 'yellow' | 'orange' | 'red' = 'green';
      if (mag >= 6.0) alertLevel = 'red';
      else if (mag >= 5.0) alertLevel = 'orange';
      else if (mag >= 4.0) alertLevel = 'yellow';

      return {
        magnitude: mag,
        location: quake.properties.place,
        time: quake.properties.time,
        depth: quake.geometry.coordinates[2],
        alertLevel,
        url: quake.properties.url
      };
    }

    return null; // No significant earthquakes
  } catch (error) {
    // Silently fail to avoid console clutter on network errors
    // logger.error('Failed to fetch seismic data:', error);
    return null; // Fail gracefully
  }
};

/**
 * Orchestrates the fetching of all environmental data.
 */
export const fetchEnvironmentContext = async (lat?: number, lon?: number): Promise<EnvironmentContext> => {
  const [weather, seismic] = await Promise.all([
    fetchWeatherData(lat, lon),
    fetchSeismicData(lat, lon)
  ]);

  return {
    weather,
    seismic,
    lastUpdated: Date.now()
  };
};

// --- Helpers & Mocks ---

/**
 * Fetch AQI from OpenWeatherMap Air Pollution endpoint and map the
 * 1–5 scale to a human-readable es-CL label. Returns `null` if the
 * key is missing or the request fails — callers surface the honest
 * empty state.
 */
const AQI_LABELS: Record<number, string> = {
  1: 'Buena',
  2: 'Aceptable',
  3: 'Moderada',
  4: 'Mala',
  5: 'Muy mala',
};

const fetchAirQualityLabel = async (lat: number, lon: number): Promise<string | null> => {
  if (!OPENWEATHER_API_KEY) return null;
  try {
    const response = await fetch(
      `https://api.openweathermap.org/data/2.5/air_pollution?lat=${lat}&lon=${lon}&appid=${OPENWEATHER_API_KEY}`
    );
    if (!response.ok) return null;
    const data = await response.json();
    const aqi = data?.list?.[0]?.main?.aqi;
    if (typeof aqi !== 'number') return null;
    return AQI_LABELS[aqi] ?? null;
  } catch {
    return null;
  }
};

/**
 * Round 18 (R6): honest empty-state fallback.
 *
 * Previously this function fabricated numbers (24°C, 55 km/h, AQI
 * "Moderada", altitude 1200 m, "Faena Minera") whenever the
 * OPENWEATHER_API_KEY was missing. Round 17 made the success path
 * truthful (null airQuality / null altitude); the mock fallback was
 * still lying. Now every field is `null` and `unavailable: true` is
 * set so the UI renders "Datos no disponibles — verifique
 * configuración OPENWEATHER_API_KEY" instead of plotting fictional
 * telemetry that crews could mistake for real readings.
 *
 * Numeric/string fields on `WeatherData` are typed non-null for
 * callers that read them on the success path; the cast at the return
 * site is intentional and safe because consumers MUST short-circuit
 * on `unavailable === true` before dereferencing them.
 */
const getMockWeatherData = (): WeatherData => {
  return {
    temp: null as unknown as number,
    condition: null as unknown as string,
    humidity: null as unknown as number,
    uv: null,
    airQuality: null,
    altitude: null,
    location: null,
    windSpeed: undefined,
    recommendations: [],
    sunrise: undefined,
    sunset: undefined,
    unavailable: true,
  };
};

const generateWeatherRecommendations = (temp: number, windSpeedKmH: number): string[] => {
  const recs: string[] = [];
  
  if (temp > 30) {
    recs.push('Alerta de calor: Hidratación obligatoria cada 30 min.');
    recs.push('Programar tareas pesadas en horarios de menor temperatura.');
  } else if (temp < 5) {
    recs.push('Alerta de frío: Uso de ropa térmica obligatoria.');
    recs.push('Revisar congelamiento en superficies de tránsito.');
  }

  if (windSpeedKmH > 40) {
    recs.push('Alerta de viento: Suspender trabajos en altura e izajes.');
    recs.push('Asegurar materiales sueltos en terreno.');
  }

  if (recs.length === 0) {
    recs.push('Condiciones normales. Mantener precauciones estándar.');
  }

  return recs;
};

import { WeatherData, SeismicData, EnvironmentContext } from '../types';

const OPENWEATHER_API_KEY = import.meta.env.VITE_OPENWEATHER_API_KEY;

// Default coordinates (Santiago, Chile) if none provided
const DEFAULT_LAT = -33.4489;
const DEFAULT_LON = -70.6693;

/**
 * Fetches weather data from OpenWeatherMap API.
 * Implements resilience: returns mock data if API key is missing or request fails.
 */
export const fetchWeatherData = async (lat: number = DEFAULT_LAT, lon: number = DEFAULT_LON): Promise<WeatherData> => {
  if (!OPENWEATHER_API_KEY) {
    console.warn('VITE_OPENWEATHER_API_KEY not found. Using mock weather data.');
    return getMockWeatherData();
  }

  try {
    const response = await fetch(
      `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${OPENWEATHER_API_KEY}&units=metric&lang=es`
    );

    if (!response.ok) {
      throw new Error(`Weather API error: ${response.statusText}`);
    }

    const data = await response.json();
    
    return {
      temp: Math.round(data.main.temp),
      condition: data.weather[0]?.description || 'Despejado',
      humidity: data.main.humidity,
      uv: 5, // OpenWeather free tier doesn't include UV in this endpoint, mocking it
      // ── Round 17 (R4): honest empty state ──────────────────────
      // Try OpenWeatherMap's Air Pollution endpoint when the key is
      // present; otherwise return null so the UI renders an honest
      // "Datos no disponibles" placeholder instead of the previous
      // hard-coded 'Buena'/500. Altitude requires a separate
      // elevation API which is not wired yet — null is the truth.
      airQuality: await fetchAirQualityLabel(lat, lon),
      altitude: null, // requires elevation API (Open-Elevation/Google) — not wired
      location: data.name,
      windSpeed: data.wind.speed * 3.6, // Convert m/s to km/h
      recommendations: generateWeatherRecommendations(data.main.temp, data.wind.speed * 3.6),
      sunrise: data.sys.sunrise * 1000, // Convert to ms
      sunset: data.sys.sunset * 1000 // Convert to ms
    };
  } catch (error) {
    // Silently fail to avoid console clutter on network errors
    // console.error('Failed to fetch weather data, falling back to mock:', error);
    return getMockWeatherData();
  }
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
    // console.error('Failed to fetch seismic data:', error);
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
    uv: null as unknown as number,
    airQuality: null,
    altitude: null,
    location: null as unknown as string,
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

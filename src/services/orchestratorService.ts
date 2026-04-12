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
      airQuality: 'Buena', // Mocking AQI
      altitude: 500, // Mocking altitude
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

const getMockWeatherData = (): WeatherData => {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  
  return {
    temp: 24,
    condition: 'Soleado',
    humidity: 45,
    uv: 8,
    airQuality: 'Moderada',
    altitude: 1200,
    location: 'Faena Minera',
    windSpeed: 55, // Set to 55 to trigger Haki de Observacion Consultivo
    recommendations: [
      'Uso obligatorio de bloqueador solar FPS 50+',
      'Hidratación cada 45 minutos',
      'Precaución con polvo en suspensión'
    ],
    sunrise: todayStart + 7 * 60 * 60 * 1000, // 07:00 AM
    sunset: todayStart + 20 * 60 * 60 * 1000 // 08:00 PM
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

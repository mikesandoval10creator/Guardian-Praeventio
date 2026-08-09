import type { WeatherData } from "../types";
import { apiAuthHeaders } from "../lib/apiAuth";
import { fetchWeatherData } from "./orchestratorService";

export interface ProjectWeatherTarget {
  id: string;
  coordinates?: { lat: number; lng: number };
}

export interface ForecastApiDay {
  date: string | Date;
  conditionCode?:
    | "sunny"
    | "rainy"
    | "stormy"
    | "windy"
    | "extreme-heat"
    | "cold-snap"
    | "snow";
  temperatureC?: number;
  windKmh?: number;
  precipMm?: number;
}

export interface ForecastSource {
  projectId: string;
  coordinates: { lat: number; lng: number };
  fetchedAt: string;
  available: boolean;
}

export interface ProjectWeatherResult {
  current: WeatherData | null;
  forecast: ForecastApiDay[] | null;
  source?: ForecastSource;
  available: boolean;
}

function validCoordinates(
  coordinates: ProjectWeatherTarget["coordinates"],
): coordinates is { lat: number; lng: number } {
  return Boolean(
    coordinates &&
    Number.isFinite(coordinates.lat) &&
    coordinates.lat >= -90 &&
    coordinates.lat <= 90 &&
    Number.isFinite(coordinates.lng) &&
    coordinates.lng >= -180 &&
    coordinates.lng <= 180,
  );
}

/**
 * Loads weather for exactly one selected project.
 *
 * Current weather uses the selected project's coordinates. Multi-day forecast
 * sends only the project ID to the authenticated server endpoint, which
 * re-authorizes membership and resolves coordinates from Firestore. The client
 * cannot substitute arbitrary coordinates for another faena.
 */
export async function loadProjectWeather(
  project: ProjectWeatherTarget,
): Promise<ProjectWeatherResult> {
  const projectId = project.id.trim();
  if (!projectId) {
    return { current: null, forecast: null, available: false };
  }

  const current = validCoordinates(project.coordinates)
    ? await fetchWeatherData(
        project.coordinates.lat,
        project.coordinates.lng,
      ).catch(() => null)
    : null;

  try {
    const headers = await apiAuthHeaders();
    const params = new URLSearchParams({ days: "3", projectId });
    const response = await fetch(
      `/api/environment/forecast?${params.toString()}`,
      {
        headers,
      },
    );
    if (!response.ok) {
      return { current, forecast: null, available: false };
    }

    const data = (await response.json()) as {
      forecast?: unknown;
      source?: ForecastSource;
    };
    const forecast = Array.isArray(data.forecast)
      ? (data.forecast as ForecastApiDay[])
      : [];
    return {
      current,
      forecast,
      source: data.source,
      available: forecast.length > 0 && data.source?.available !== false,
    };
  } catch {
    return { current, forecast: null, available: false };
  }
}

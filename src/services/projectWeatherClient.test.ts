import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const H = vi.hoisted(() => ({
  fetchWeatherData: vi.fn(),
  apiAuthHeaders: vi.fn(),
}));

vi.mock("./orchestratorService", () => ({
  fetchWeatherData: H.fetchWeatherData,
}));
vi.mock("../lib/apiAuth", () => ({
  apiAuthHeaders: H.apiAuthHeaders,
}));

import { loadProjectWeather } from "./projectWeatherClient";

beforeEach(() => {
  H.fetchWeatherData.mockReset();
  H.apiAuthHeaders.mockReset();
  H.fetchWeatherData.mockResolvedValue({
    temp: 17,
    condition: "Despejado",
    humidity: 50,
    uv: 2,
    airQuality: null,
    altitude: null,
    location: "Lima",
    recommendations: [],
  });
  H.apiAuthHeaders.mockResolvedValue({ Authorization: "Bearer fixture" });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loadProjectWeather", () => {
  it("fails closed without a project identity and does no I/O", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await loadProjectWeather({ id: "" });

    expect(result).toEqual({ current: null, forecast: null, available: false });
    expect(H.fetchWeatherData).not.toHaveBeenCalled();
    expect(H.apiAuthHeaders).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("lets the server resolve authoritative coordinates when the client project is missing them", async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: false,
      status: 422,
      json: async () => ({ error: "project_coordinates_unavailable" }),
    }));
    vi.stubGlobal("fetch", fetchSpy);

    const result = await loadProjectWeather({ id: "site-missing" });

    expect(H.fetchWeatherData).not.toHaveBeenCalled();
    expect(H.apiAuthHeaders).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/environment/forecast?days=3&projectId=site-missing",
      { headers: { Authorization: "Bearer fixture" } },
    );
    expect(result).toEqual({ current: null, forecast: null, available: false });
  });

  it("uses coordinates only for current weather and projectId for the authoritative forecast", async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        forecast: [{ date: "2026-08-10", temperatureC: 18 }],
        source: {
          projectId: "site/lima",
          coordinates: { lat: -12.05, lng: -77.04 },
          fetchedAt: "2026-08-09T20:00:00.000Z",
          available: true,
        },
      }),
    }));
    vi.stubGlobal("fetch", fetchSpy);

    const result = await loadProjectWeather({
      id: "site/lima",
      coordinates: { lat: -12.05, lng: -77.04 },
    });

    expect(H.fetchWeatherData).toHaveBeenCalledWith(-12.05, -77.04);
    expect(H.apiAuthHeaders).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/environment/forecast?days=3&projectId=site%2Flima",
      { headers: { Authorization: "Bearer fixture" } },
    );
    expect(result.available).toBe(true);
    expect(result.forecast).toHaveLength(1);
    expect(result.source?.projectId).toBe("site/lima");
  });

  it("keeps current weather but marks the forecast unavailable on an honest 422", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 422,
        json: async () => ({ error: "project_coordinates_unavailable" }),
      })),
    );

    const result = await loadProjectWeather({
      id: "site-lima",
      coordinates: { lat: -12.05, lng: -77.04 },
    });

    expect(result.current?.location).toBe("Lima");
    expect(result.forecast).toBeNull();
    expect(result.available).toBe(false);
  });
});

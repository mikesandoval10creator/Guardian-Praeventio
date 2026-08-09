// @vitest-environment jsdom

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

const H = vi.hoisted(() => ({
  selectedProject: null as null | {
    id: string;
    name: string;
    coordinates?: { lat: number; lng: number };
  },
}));

vi.mock("../contexts/ThemeContext", () => ({
  useTheme: () => ({ isDayTime: true }),
}));
vi.mock("../contexts/ProjectContext", () => ({
  useProject: () => ({ selectedProject: H.selectedProject }),
}));
vi.mock("../hooks/useSeismicMonitor", () => ({
  useSeismicMonitor: () => ({
    earthquakes: [],
    criticalAlert: null,
    error: H.selectedProject?.coordinates
      ? null
      : "project_coordinates_unavailable",
  }),
}));
vi.mock("framer-motion", () => ({
  motion: { section: "section", div: "div", span: "span" },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
}));

import { WeatherBulletin } from "./WeatherBulletin";

const OPEN_METEO_RESPONSE = {
  current_units: {
    temperature_2m: "°C",
    relative_humidity_2m: "%",
    precipitation: "mm",
    wind_speed_10m: "km/h",
    uv_index: "",
  },
  current: {
    temperature_2m: 19,
    relative_humidity_2m: 60,
    precipitation: 0,
    wind_speed_10m: 8,
    uv_index: 3,
  },
};

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("WeatherBulletin project location", () => {
  it("does not fetch or label Santiago when the selected project has no coordinates", async () => {
    H.selectedProject = { id: "missing", name: "Faena sin ubicación" };
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    render(<WeatherBulletin />);

    await waitFor(() => {
      expect(screen.getByText("Ubicación no disponible")).toBeInTheDocument();
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(screen.queryByText(/Santiago/i)).not.toBeInTheDocument();
    expect(
      screen.getByText("Datos sísmicos no disponibles"),
    ).toBeInTheDocument();
    expect(screen.getByText("Altitud no disponible")).toBeInTheDocument();
    expect(screen.queryByText("Sin actividad")).not.toBeInTheDocument();
    expect(screen.queryByText("Normal")).not.toBeInTheDocument();
  });

  it("requests Open-Meteo with the selected project coordinates and labels that project", async () => {
    H.selectedProject = {
      id: "lima",
      name: "Faena Lima",
      coordinates: { lat: -12.05, lng: -77.04 },
    };
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      json: async () => OPEN_METEO_RESPONSE,
    }));
    vi.stubGlobal("fetch", fetchSpy);

    render(<WeatherBulletin />);

    await waitFor(() =>
      expect(screen.getByText("Faena Lima")).toBeInTheDocument(),
    );
    const url = String((fetchSpy.mock.calls as unknown[][])[0]?.[0]);
    expect(url).toContain("latitude=-12.05");
    expect(url).toContain("longitude=-77.04");
    expect(url).toContain("timezone=auto");
    expect(url).not.toContain("Santiago");
  });
});

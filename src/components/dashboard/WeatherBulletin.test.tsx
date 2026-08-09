// @vitest-environment jsdom

import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const H = vi.hoisted(() => ({ sunTracker: vi.fn() }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (
      _key: string,
      fallback: string | { defaultValue?: string; minutes?: number },
    ) =>
      typeof fallback === "string"
        ? fallback
        : (fallback.defaultValue ?? "").replace(
            "{{minutes}}",
            String(fallback.minutes),
          ),
  }),
}));
vi.mock("../SunTrackerContainer", () => ({
  SunTrackerContainer: (props: { lat: number; lng: number }) => {
    H.sunTracker(props);
    return <div data-testid="sun-tracker" />;
  },
}));
vi.mock("../weather/NativeCompass", () => ({ NativeCompass: () => <div /> }));

import { WeatherBulletin } from "./WeatherBulletin";

afterEach(() => {
  cleanup();
  H.sunTracker.mockReset();
});

describe("dashboard WeatherBulletin source honesty", () => {
  it("does not substitute Santiago ephemeris, altitude, or AQI without source data", () => {
    render(<WeatherBulletin weather={{ unavailable: true }} loading={false} />);

    expect(
      screen.getByText("Datos meteorológicos no disponibles"),
    ).toBeInTheDocument();
    expect(screen.getByText("Ubicación no disponible")).toBeInTheDocument();
    expect(screen.queryByTestId("sun-tracker")).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Santiago|567|\(est\.\)/i),
    ).not.toBeInTheDocument();
  });

  it("passes only the authoritative weather source coordinates to SunTracker", () => {
    render(
      <WeatherBulletin
        loading={false}
        weather={{
          temp: 18,
          windSpeed: 10,
          condition: "Despejado",
          humidity: 50,
          uv: 3,
          airQuality: null,
          altitude: null,
          sourceCoordinates: { lat: -12.05, lng: -77.04 },
          measuredAt: Date.now() - 2 * 60_000,
        }}
      />,
    );

    expect(H.sunTracker).toHaveBeenCalledWith(
      expect.objectContaining({ lat: -12.05, lng: -77.04 }),
    );
    expect(screen.getByText(/hace 2 min/)).toBeInTheDocument();
  });
});

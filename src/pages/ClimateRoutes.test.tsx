// @vitest-environment jsdom
//
// Praeventio Guard — ClimateRoutes "Calcular Ruta Óptima" honesty pin.
//
// Vial-safety regression (2026-06-13): the "Calcular Ruta Óptima" button used
// to ONLY cycle routeStatus (safe→warning→danger) on click WITHOUT invoking
// any calculation. That meant a worker could see "Ruta Segura" without a
// single NASA POWER / EONET / Google Directions query ever running — a
// dangerous false reassurance on a route-planning tool.
//
// These tests pin that:
//   1. Clicking the button invokes the REAL calculateRoute path, which calls
//      window.google DirectionsService AND the assessRouteClimate engine.
//   2. The displayed route status is DERIVED from the assessment result — it
//      reflects whatever assessRouteClimate returns, and the click cannot
//      flip the status independently of an assessment.
//
// Hermetic: maps, the climate engine, toasts and logger are mocked. Pattern
// mirrors `SafeDriving.test.tsx`.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { RouteAssessmentResult } from '../services/routing/routeClimateAssessment';
import { ClimateRoutes } from './ClimateRoutes';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string) => (typeof fallback === 'string' ? fallback : _k),
  }),
}));
vi.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    {
      get:
        () =>
        (props: Record<string, unknown> & { children?: React.ReactNode }) => {
          const { children, ...rest } = props;
          const safe = Object.fromEntries(
            Object.entries(rest).filter(
              ([k]) =>
                ![
                  'initial',
                  'animate',
                  'exit',
                  'transition',
                  'whileHover',
                  'whileTap',
                  'pathLength',
                ].includes(k),
            ),
          );
          return <div {...(safe as Record<string, unknown>)}>{children}</div>;
        },
    },
  ),
}));
// Map is "loaded" so calculateRoute can run; render primitives are inert.
vi.mock('@react-google-maps/api', () => ({
  useJsApiLoader: () => ({ isLoaded: true }),
  GoogleMap: () => null,
  DirectionsRenderer: () => null,
}));
vi.mock('../components/maps/mapConfig', () => ({ getMapLoaderConfig: () => ({}) }));
vi.mock('../utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('../hooks/useToast', () => ({
  useToast: () => ({ toasts: [], show: vi.fn(), dismiss: vi.fn() }),
}));

// The real climate engine (NASA POWER + EONET) — mocked so we control the
// status the UI must derive from, and so we can assert the click reaches it.
const assessRouteClimateMock = vi.fn();
vi.mock('../services/routing/routeClimateAssessment', () => ({
  assessRouteClimate: (...args: unknown[]) => assessRouteClimateMock(...args),
}));

// Minimal Google Directions stub: a single-leg route with an overview_path so
// calculateRoute derives a midpoint/bbox and proceeds to the assessment.
const routeCall = vi.fn();
function stubGoogleMaps() {
  const latLng = (lat: number, lng: number) => ({ lat: () => lat, lng: () => lng });
  class DirectionsService {
    async route(req: unknown) {
      routeCall(req);
      return {
        routes: [
          {
            summary: 'Ruta CH-60',
            legs: [
              {
                distance: { value: 120_000 },
                duration: { value: 7_200 },
                start_location: latLng(-33.45, -70.66),
                end_location: latLng(-33.04, -71.62),
              },
            ],
            overview_path: [
              latLng(-33.45, -70.66),
              latLng(-33.25, -71.1),
              latLng(-33.04, -71.62),
            ],
          },
        ],
      };
    }
  }
  (window as unknown as { google: unknown }).google = {
    maps: { DirectionsService, TravelMode: { DRIVING: 'DRIVING' } },
  };
}

function makeAssessment(status: RouteAssessmentResult['status']): RouteAssessmentResult {
  return {
    status,
    reasons: [
      {
        level: status,
        category: 'wind',
        message: `assessment-${status}`,
        source: 'NASA_POWER',
      },
    ],
    metrics: {
      avgWindMs: 5,
      maxWindMs: 9,
      totalPrecipMm: 10,
      frostHourCount: 0,
      activeEventCount: 0,
      distanceKm: 120,
      durationHours: 2,
      isMountainPass: false,
    },
    activeEvents: [],
    failedSources: [],
  };
}

beforeEach(() => {
  assessRouteClimateMock.mockReset();
  routeCall.mockReset();
  stubGoogleMaps();
});

describe('ClimateRoutes — "Calcular Ruta Óptima" runs the real assessment', () => {
  it('invokes Google Directions AND the climate engine when clicked', async () => {
    assessRouteClimateMock.mockResolvedValue(makeAssessment('danger'));
    render(<ClimateRoutes />);

    // Mount effect runs one calculation; wait for it to settle.
    await waitFor(() => expect(assessRouteClimateMock).toHaveBeenCalled());
    const callsAfterMount = assessRouteClimateMock.mock.calls.length;
    const routeCallsAfterMount = routeCall.mock.calls.length;

    fireEvent.click(screen.getByText('Calcular Ruta Óptima'));

    // The click must hit BOTH the real Directions service and the engine —
    // not a local status cycle.
    await waitFor(() =>
      expect(routeCall.mock.calls.length).toBeGreaterThan(routeCallsAfterMount),
    );
    await waitFor(() =>
      expect(assessRouteClimateMock.mock.calls.length).toBeGreaterThan(callsAfterMount),
    );
  });

  it('derives the displayed status from the assessment result, not a manual cycle', async () => {
    // First (mount) assessment is safe → the click must NOT independently flip
    // status; it must re-derive from whatever the engine returns next.
    assessRouteClimateMock.mockResolvedValueOnce(makeAssessment('safe'));
    render(<ClimateRoutes />);

    await waitFor(() => expect(screen.getByText('Ruta Segura')).toBeTruthy());
    expect(assessRouteClimateMock).toHaveBeenCalledTimes(1);

    // Next assessment returns danger → after the click the UI reflects danger,
    // because status is sourced ONLY from the assessment.
    assessRouteClimateMock.mockResolvedValueOnce(makeAssessment('danger'));
    fireEvent.click(screen.getByText('Calcular Ruta Óptima'));

    await waitFor(() => expect(screen.getByText('Ruta Intransitable')).toBeTruthy());
    // No way to reach danger without the engine having produced it.
    expect(assessRouteClimateMock).toHaveBeenCalledTimes(2);
    expect(assessRouteClimateMock.mock.results[1]!.value).resolves.toMatchObject({
      status: 'danger',
    });
  });

  it('does not change status when the engine produces no new assessment (no blind cycle)', async () => {
    // Engine rejects on the click → calculateRoute falls back to status 'safe'
    // with assessment=null (honest degrade), it must NEVER fabricate a
    // warning/danger out of a manual cycle.
    assessRouteClimateMock.mockResolvedValueOnce(makeAssessment('safe'));
    render(<ClimateRoutes />);
    await waitFor(() => expect(screen.getByText('Ruta Segura')).toBeTruthy());

    assessRouteClimateMock.mockRejectedValueOnce(new Error('NASA offline'));
    fireEvent.click(screen.getByText('Calcular Ruta Óptima'));

    // Engine was consulted; the prior cycle behaviour (safe→warning) is gone.
    await waitFor(() => expect(assessRouteClimateMock).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('Precaución Requerida')).toBeNull();
    expect(screen.getByText('Ruta Segura')).toBeTruthy();
  });
});

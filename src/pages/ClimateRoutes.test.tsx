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

// Stable `t` / `show` references across renders — real react-i18next and
// useToast return memoized callbacks. A fresh function each render would give
// `calculateRoute` (which now lists `t`/`showToast` in its deps, per review
// #872 hallazgo A) a new identity every render and loop the mount effect.
const tFn = (_k: string, fallback?: string) =>
  typeof fallback === 'string' ? fallback : _k;
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: tFn }),
}));
vi.mock('framer-motion', () => ({
  // ToastContainer (rendered unconditionally by ClimateRoutes) imports
  // AnimatePresence — without it the whole tree throws before any assertion.
  AnimatePresence: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
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
const showToastFn = vi.fn();
const dismissToastFn = vi.fn();
vi.mock('../hooks/useToast', () => ({
  useToast: () => ({ toasts: [], show: showToastFn, dismiss: dismissToastFn }),
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

// Click the calculate button only once it shows its IDLE label. While an
// assessment is in flight the button swaps to "Evaluando ruta…", so a
// synchronous getByText('Calcular Ruta Óptima') right after a status `waitFor`
// can race the loading state on a slow runner — the source of the #872 CI flake
// (status badge and button label are separate state). `findByText` retries until
// the button is idle, making the click deterministic without weakening any
// assertion (assessment call counts are unchanged).
async function clickCalcular() {
  fireEvent.click(await screen.findByText('Calcular Ruta Óptima'));
}

describe('ClimateRoutes — "Calcular Ruta Óptima" runs the real assessment', () => {
  it('invokes Google Directions AND the climate engine when clicked', async () => {
    assessRouteClimateMock.mockResolvedValue(makeAssessment('danger'));
    render(<ClimateRoutes />);

    // Mount effect runs one calculation; wait for it to settle.
    await waitFor(() => expect(assessRouteClimateMock).toHaveBeenCalled());
    const callsAfterMount = assessRouteClimateMock.mock.calls.length;
    const routeCallsAfterMount = routeCall.mock.calls.length;

    await clickCalcular();

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
    await clickCalcular();

    await waitFor(() => expect(screen.getByText('Ruta Intransitable')).toBeTruthy());
    // No way to reach danger without the engine having produced it.
    expect(assessRouteClimateMock).toHaveBeenCalledTimes(2);
    expect(assessRouteClimateMock.mock.results[1]!.value).resolves.toMatchObject({
      status: 'danger',
    });
  });

  it('never fabricates a status from a manual cycle (no blind safe→warning→danger)', async () => {
    // Pin the absence of the old behaviour: the click does not advance a
    // local cycle — the status is ALWAYS sourced from the engine. Here the
    // engine keeps returning 'warning', so the UI stays on 'warning' no
    // matter how many times we click (the old code would have cycled to
    // 'danger' then 'safe').
    assessRouteClimateMock.mockResolvedValue(makeAssessment('warning'));
    render(<ClimateRoutes />);
    await waitFor(() => expect(screen.getByText('Precaución Requerida')).toBeTruthy());

    await clickCalcular();
    await waitFor(() => expect(assessRouteClimateMock).toHaveBeenCalledTimes(2));
    expect(screen.getByText('Precaución Requerida')).toBeTruthy();
    expect(screen.queryByText('Ruta Intransitable')).toBeNull();
    expect(screen.queryByText('Ruta Segura')).toBeNull();
  });

  // Review #872 hallazgo B — the dangerous degradation regression.
  describe('does NOT degrade to "Ruta Segura" when the assessment throws', () => {
    it('preserves a previous DANGER status when the engine throws (life-safety)', async () => {
      // Route was previously assessed as Intransitable (danger). NASA/EONET or
      // the geometry processing then throws on the next click. The OLD catch
      // did setRouteStatus('safe') — flipping "Ruta Intransitable" to "Ruta
      // Segura" with ZERO evidence, a potentially fatal false reassurance.
      // The fix must keep DANGER, never claim safety.
      assessRouteClimateMock.mockResolvedValueOnce(makeAssessment('danger'));
      render(<ClimateRoutes />);
      await waitFor(() => expect(screen.getByText('Ruta Intransitable')).toBeTruthy());

      assessRouteClimateMock.mockRejectedValueOnce(new Error('NASA offline'));
      await clickCalcular();

      await waitFor(() => expect(assessRouteClimateMock).toHaveBeenCalledTimes(2));
      // The status MUST NOT have degraded to safe.
      expect(screen.queryByText('Ruta Segura')).toBeNull();
      // It stays at the prior danger level — we never lower an active warning
      // on unverified failure.
      expect(screen.getByText('Ruta Intransitable')).toBeTruthy();
    });

    it('falls back to PRECAUCIÓN (never safe) when the engine throws from a non-danger state', async () => {
      // Previous state was safe; the engine throws on the click. We must not
      // re-assert "Ruta Segura" blindly — fail-safe is precaution + an honest
      // "no pudimos consultar las fuentes" assessment, not a green light.
      assessRouteClimateMock.mockResolvedValueOnce(makeAssessment('safe'));
      render(<ClimateRoutes />);
      await waitFor(() => expect(screen.getByText('Ruta Segura')).toBeTruthy());

      assessRouteClimateMock.mockRejectedValueOnce(new Error('EONET 503'));
      await clickCalcular();

      await waitFor(() => expect(assessRouteClimateMock).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(screen.getByText('Precaución Requerida')).toBeTruthy());
      // No green light without evidence.
      expect(screen.queryByText('Ruta Segura')).toBeNull();
    });
  });
});

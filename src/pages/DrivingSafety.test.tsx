// @vitest-environment jsdom
//
// Praeventio Guard — Sprint K §69-71 page wrapper tests.
//
// Smoke tests for `<DrivingSafety />`:
//   1. Empty state when no project is selected.
//   2. Loading state from the routes hook.
//   3. Error state surfaces with message.
//   4. Routes render with criticality badge + hazards + alert banner.
//   5. Drivers render with fatigue + license countdown.
//   6. Ranking render with score + level.
//   7. Register route action calls the mutation.
//
// Hermetic: hooks and contexts are mocked so the test has no fetch,
// no Firestore, no router state. Matches the patterns used by
// LeadershipDecisions.test.tsx + CorrectiveActions.test.tsx.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DrivingSafety } from './DrivingSafety';
import * as sprintKHooks from '../hooks/useDrivingSafety';
import type {
  DrivingRoute,
  DrivingDriver,
  DrivingRankingEntry,
  DrivingRoutesResponse,
  DrivingDriversResponse,
  DrivingRankingResponse,
} from '../hooks/useDrivingSafety';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (
      _k: string,
      fallback?: string | Record<string, unknown>,
      opts?: Record<string, unknown>,
    ) => {
      if (typeof fallback === 'string') {
        if (opts && typeof opts === 'object') {
          let out = fallback;
          for (const [key, val] of Object.entries(opts)) {
            out = out.replace(`{{${key}}}`, String(val));
          }
          return out;
        }
        return fallback;
      }
      return _k;
    },
  }),
}));

type RoutesMock = {
  data: DrivingRoutesResponse | null;
  loading: boolean;
  error: Error | null;
  refetch?: () => void;
};
type DriversMock = {
  data: DrivingDriversResponse | null;
  loading: boolean;
  error: Error | null;
  refetch?: () => void;
};
type RankingMock = {
  data: DrivingRankingResponse | null;
  loading: boolean;
  error: Error | null;
  refetch?: () => void;
};

let mockSelectedProject: { id: string; name: string } | null = null;
let mockIsOnline = true;
let mockRoutes: RoutesMock;
let mockDrivers: DriversMock;
let mockRanking: RankingMock;

vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => ({ selectedProject: mockSelectedProject }),
}));
vi.mock('../hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => mockIsOnline,
}));
vi.mock('../hooks/useDrivingSafety', () => ({
  useDrivingRoutes: () => mockRoutes,
  useDrivingDrivers: () => mockDrivers,
  useDrivingRanking: () => mockRanking,
  registerRoute: vi.fn(),
  flagRouteAlert: vi.fn(),
  recordJourney: vi.fn(),
}));

function emptyRoutes(): RoutesMock {
  return { data: { routes: [] }, loading: false, error: null, refetch: vi.fn() };
}
function emptyDrivers(): DriversMock {
  return { data: { drivers: [] }, loading: false, error: null, refetch: vi.fn() };
}
function emptyRanking(): RankingMock {
  return { data: { ranking: [] }, loading: false, error: null, refetch: vi.fn() };
}

function makeRoute(over: Partial<DrivingRoute> & { id: string }): DrivingRoute {
  return {
    id: over.id,
    name: over.name ?? `Ruta ${over.id}`,
    origin: over.origin ?? 'Origen X',
    destination: over.destination ?? 'Destino Y',
    distanceKm: over.distanceKm ?? 80,
    criticality: over.criticality ?? 'medium',
    hazards: over.hazards ?? [],
    weatherSensitive: over.weatherSensitive ?? false,
    recommendedMaxSpeedKmh: over.recommendedMaxSpeedKmh ?? 60,
    activeAlert: over.activeAlert ?? null,
    alertHistory: over.alertHistory ?? [],
    createdAt: over.createdAt ?? '2026-05-10T10:00:00Z',
    createdBy: over.createdBy ?? 'uid_admin',
    updatedAt: over.updatedAt ?? '2026-05-10T10:00:00Z',
  };
}

function makeDriver(
  over: Partial<DrivingDriver> & { workerUid: string },
): DrivingDriver {
  return {
    workerUid: over.workerUid,
    licenseClass: over.licenseClass ?? 'A4',
    licenseExpiresAt: over.licenseExpiresAt ?? '2027-01-01T00:00:00Z',
    yearsExperience: over.yearsExperience ?? 5,
    incidents12m: over.incidents12m ?? 0,
    speedingEvents30d: over.speedingEvents30d ?? 0,
    fatigueScore: over.fatigueScore ?? 30,
    hoursThisWeek: over.hoursThisWeek ?? 12,
    lastJourneyAt: over.lastJourneyAt ?? '2026-05-15T08:00:00Z',
    updatedAt: over.updatedAt ?? '2026-05-15T08:00:00Z',
  };
}

function makeRankingEntry(
  over: Partial<DrivingRankingEntry> & { workerUid: string },
): DrivingRankingEntry {
  return {
    workerUid: over.workerUid,
    safetyScore: over.safetyScore ?? 85,
    level: over.level ?? 'good',
    canOperate: over.canOperate ?? true,
    blockers: over.blockers ?? [],
    fatigueScore: over.fatigueScore ?? 30,
    hoursThisWeek: over.hoursThisWeek ?? 10,
    licenseExpiresAt: over.licenseExpiresAt ?? '2027-01-01T00:00:00Z',
  };
}

beforeEach(() => {
  mockSelectedProject = null;
  mockIsOnline = true;
  mockRoutes = emptyRoutes();
  mockDrivers = emptyDrivers();
  mockRanking = emptyRanking();
});

describe('<DrivingSafety /> page wrapper (Sprint K §69-71)', () => {
  it('renderiza empty-state cuando no hay proyecto seleccionado', () => {
    mockSelectedProject = null;
    render(<DrivingSafety />);
    expect(screen.getByTestId('driving-safety-page-empty')).toBeInTheDocument();
    expect(screen.getByText(/selecciona un proyecto/i)).toBeInTheDocument();
  });

  it('renderiza loading mientras el hook de rutas está cargando', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockRoutes = { data: null, loading: true, error: null, refetch: vi.fn() };
    render(<DrivingSafety />);
    expect(
      screen.getByTestId('driving-safety-routes-loading'),
    ).toBeInTheDocument();
  });

  it('muestra el mensaje del error del hook de rutas', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockRoutes = {
      data: null,
      loading: false,
      error: new Error('Network down'),
      refetch: vi.fn(),
    };
    render(<DrivingSafety />);
    expect(
      screen.getByTestId('driving-safety-routes-error'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Network down/i)).toBeInTheDocument();
  });

  it('renderiza rutas con badge de criticidad + hazards + banner de alerta', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockRoutes = {
      data: {
        routes: [
          makeRoute({
            id: 'r1',
            name: 'Camino Mina A',
            criticality: 'extreme',
            hazards: ['cliff', 'rockfall'],
            activeAlert: {
              kind: 'icy',
              note: 'Helada en km 30',
              flaggedAt: '2026-05-16T07:00:00Z',
              flaggedBy: 'uid_sup',
              resolvedAt: null,
            },
          }),
          makeRoute({
            id: 'r2',
            name: 'Ruta logística B',
            criticality: 'low',
          }),
        ],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    };
    render(<DrivingSafety />);
    expect(
      screen.getByTestId('driving-safety-routes-list'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('driving-safety-route-r1')).toBeInTheDocument();
    expect(screen.getByTestId('driving-safety-route-r2')).toBeInTheDocument();
    expect(screen.getByText('Camino Mina A')).toBeInTheDocument();
    // Criticality badges visible.
    expect(
      screen.getByTestId('driving-safety-route-criticality-r1'),
    ).toHaveTextContent(/extrema/i);
    // Alert banner visible for r1.
    expect(
      screen.getByTestId('driving-safety-route-alert-r1'),
    ).toBeInTheDocument();
    // Hazards list visible.
    expect(
      screen.getByTestId('driving-safety-route-hazards-r1'),
    ).toBeInTheDocument();
  });

  it('renderiza conductores con fatiga + countdown de licencia', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockDrivers = {
      data: {
        drivers: [
          makeDriver({
            workerUid: 'd_alpha',
            fatigueScore: 80,
            hoursThisWeek: 38.5,
            licenseExpiresAt: '2030-01-01T00:00:00Z',
          }),
          makeDriver({
            workerUid: 'd_beta',
            fatigueScore: 20,
            hoursThisWeek: 4,
            licenseExpiresAt: '2025-01-01T00:00:00Z',
          }),
        ],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    };
    render(<DrivingSafety />);
    fireEvent.click(screen.getByTestId('driving-safety-tab-conductores'));
    expect(
      screen.getByTestId('driving-safety-drivers-list'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('driving-safety-driver-d_alpha'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('driving-safety-driver-d_beta'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('driving-safety-driver-fatigue-d_alpha'),
    ).toHaveTextContent('80');
    // d_beta license already expired (2025 vs current date in test env).
    expect(
      screen.getByTestId('driving-safety-driver-license-d_beta'),
    ).toHaveTextContent(/vencida/i);
  });

  it('renderiza ranking ordenado por score con nivel', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockRanking = {
      data: {
        ranking: [
          makeRankingEntry({
            workerUid: 'd_top',
            safetyScore: 95,
            level: 'excellent',
          }),
          makeRankingEntry({
            workerUid: 'd_low',
            safetyScore: 35,
            level: 'critical',
            canOperate: false,
            blockers: ['3 incidentes 12m.'],
          }),
        ],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    };
    render(<DrivingSafety />);
    fireEvent.click(screen.getByTestId('driving-safety-tab-ranking'));
    expect(
      screen.getByTestId('driving-safety-ranking-list'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('driving-safety-ranking-d_top'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('driving-safety-ranking-score-d_top'),
    ).toHaveTextContent('95');
    // Blockers visible for the critical driver.
    expect(
      screen.getByTestId('driving-safety-ranking-blockers-d_low'),
    ).toBeInTheDocument();
  });

  it('al registrar una ruta llama a registerRoute y cierra el modal', async () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    const registerMock = vi.mocked(sprintKHooks.registerRoute);
    registerMock.mockResolvedValueOnce(
      makeRoute({ id: 'r_new', name: 'Ruta nueva', criticality: 'high' }),
    );

    render(<DrivingSafety />);
    fireEvent.click(screen.getByTestId('driving-safety-new-route-button'));
    expect(
      screen.getByTestId('driving-safety-new-route-modal'),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('driving-safety-new-route-modal-name'), {
      target: { value: 'Ruta Mina K' },
    });
    fireEvent.change(
      screen.getByTestId('driving-safety-new-route-modal-origin'),
      { target: { value: 'Campamento Sur' } },
    );
    fireEvent.change(
      screen.getByTestId('driving-safety-new-route-modal-destination'),
      { target: { value: 'Tajo Norte' } },
    );
    fireEvent.change(
      screen.getByTestId('driving-safety-new-route-modal-criticality'),
      { target: { value: 'high' } },
    );

    fireEvent.click(
      screen.getByTestId('driving-safety-new-route-modal-submit'),
    );

    await waitFor(() => {
      expect(registerMock).toHaveBeenCalledWith(
        'p-1',
        expect.objectContaining({
          name: 'Ruta Mina K',
          origin: 'Campamento Sur',
          destination: 'Tajo Norte',
          criticality: 'high',
        }),
      );
    });
    await waitFor(() => {
      expect(
        screen.queryByTestId('driving-safety-new-route-modal'),
      ).not.toBeInTheDocument();
    });
  });
});

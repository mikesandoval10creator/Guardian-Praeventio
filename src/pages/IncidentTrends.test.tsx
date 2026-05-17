// @vitest-environment jsdom
//
// Praeventio Guard — F.29 page wrapper tests.
//
// Smoke tests for `<IncidentTrends />`:
//   1. Empty-state cuando no hay proyecto seleccionado.
//   2. Loading state desde el hook.
//   3. Error state desde el hook.
//   4. Render de chart + direction chip + leading indicators.
//   5. Cambio de ventana (12m → 3m) re-llama al hook con el nuevo arg.
//   6. Render del breakdown por kind cuando hay buckets con `byKind`.
//
// Hermetic: hooks y contexto mockeados — sin fetch real ni Firestore.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { IncidentTrends } from './IncidentTrends';
import type { IncidentTrendsResponse } from '../hooks/useSprintK';

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

type TrendsMock = {
  data: IncidentTrendsResponse | null;
  loading: boolean;
  error: Error | null;
};

let mockSelectedProject: { id: string; name: string } | null = null;
let mockIsOnline = true;
let mockTrends: TrendsMock;

// Capture the most recent call args so we can assert filter behavior.
let lastTrendsCallArgs: {
  window?: string;
  group?: string;
} | null = null;

vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => ({ selectedProject: mockSelectedProject }),
}));
vi.mock('../hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => mockIsOnline,
}));
vi.mock('../hooks/useSprintK', () => ({
  useIncidentTrends: (
    _projectId: string | null,
    opts?: { window?: string; group?: string },
  ) => {
    lastTrendsCallArgs = opts ?? {};
    return mockTrends;
  },
}));

function emptyTrends(): TrendsMock {
  return {
    data: {
      window: '12m',
      group: 'month',
      totalIncidents: 0,
      buckets: [],
      leading: { nearMissRatio: 0, closureRate: 0, averageDaysOpen: 0 },
      trend: 'stable',
      trendConfidence: 0,
      generatedAt: '2026-05-17T00:00:00Z',
    },
    loading: false,
    error: null,
  };
}

function populatedTrends(over: Partial<IncidentTrendsResponse> = {}): TrendsMock {
  return {
    data: {
      window: '12m',
      group: 'month',
      totalIncidents: 24,
      buckets: [
        {
          label: '2026-01',
          count: 5,
          severityWeighted: 12,
          byKind: { fall: 3, electrical: 2 },
        },
        {
          label: '2026-02',
          count: 8,
          severityWeighted: 18,
          byKind: { fall: 4, chemical: 4 },
        },
        {
          label: '2026-03',
          count: 4,
          severityWeighted: 8,
          byKind: { fall: 2, electrical: 1, chemical: 1 },
        },
        {
          label: '2026-04',
          count: 7,
          severityWeighted: 22,
          byKind: { fall: 5, chemical: 2 },
        },
      ],
      leading: { nearMissRatio: 0.45, closureRate: 0.78, averageDaysOpen: 12.3 },
      trend: 'worsening',
      trendConfidence: 0.85,
      generatedAt: '2026-05-17T00:00:00Z',
      ...over,
    },
    loading: false,
    error: null,
  };
}

beforeEach(() => {
  mockSelectedProject = null;
  mockIsOnline = true;
  lastTrendsCallArgs = null;
  mockTrends = emptyTrends();
});

describe('<IncidentTrends /> page wrapper (F.29)', () => {
  it('renderiza empty-state cuando no hay proyecto seleccionado', () => {
    mockSelectedProject = null;
    render(<IncidentTrends />);
    expect(
      screen.getByTestId('incident-trends-page-empty'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/selecciona un proyecto/i),
    ).toBeInTheDocument();
  });

  it('renderiza loading mientras el hook está cargando', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockTrends = { data: null, loading: true, error: null };
    render(<IncidentTrends />);
    expect(
      screen.getByTestId('incident-trends-loading'),
    ).toBeInTheDocument();
  });

  it('muestra el mensaje del error del hook', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockTrends = {
      data: null,
      loading: false,
      error: new Error('Trends down'),
    };
    render(<IncidentTrends />);
    expect(
      screen.getByTestId('incident-trends-error'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Trends down/i)).toBeInTheDocument();
  });

  it('renderiza chart, dirección de tendencia y leading indicators', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockTrends = populatedTrends();
    render(<IncidentTrends />);

    // Chart se renderiza con buckets.
    expect(screen.getByTestId('incident-trends-chart')).toBeInTheDocument();
    // Direction chip muestra "Empeorando" (trend: 'worsening').
    const direction = screen.getByTestId('incident-trends-direction');
    expect(direction).toBeInTheDocument();
    expect(direction).toHaveTextContent(/empeorando/i);
    // Total visible.
    expect(screen.getByTestId('incident-trends-total')).toHaveTextContent('24');
    // Leading indicators row visible con sus valores.
    expect(
      screen.getByTestId('incident-trends-leading-near-miss-value'),
    ).toHaveTextContent('45%');
    expect(
      screen.getByTestId('incident-trends-leading-closure-value'),
    ).toHaveTextContent('78%');
    expect(
      screen.getByTestId('incident-trends-leading-days-value'),
    ).toHaveTextContent('12.3');
  });

  it('cambia la ventana (12m → 3m) y re-llama al hook con el nuevo arg', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockTrends = populatedTrends();
    render(<IncidentTrends />);

    // Inicial: hook llamado con window=12m (default del page state).
    expect(lastTrendsCallArgs?.window).toBe('12m');

    fireEvent.click(screen.getByTestId('incident-trends-window-3m'));
    expect(lastTrendsCallArgs?.window).toBe('3m');
  });

  it('renderiza breakdown por kind cuando hay categorías', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockTrends = populatedTrends();
    render(<IncidentTrends />);

    expect(
      screen.getByTestId('incident-trends-by-kind'),
    ).toBeInTheDocument();
    // Stack y leyenda visibles.
    expect(
      screen.getByTestId('incident-trends-by-kind-stack'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('incident-trends-by-kind-legend'),
    ).toBeInTheDocument();
    // Las 3 categorías de los buckets están en la leyenda (sumadas).
    // fall: 3+4+2+5 = 14, chemical: 4+1+2 = 7, electrical: 2+1 = 3.
    expect(
      screen.getByTestId('incident-trends-by-kind-fall'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('incident-trends-by-kind-fall'),
    ).toHaveTextContent('14');
    expect(
      screen.getByTestId('incident-trends-by-kind-chemical'),
    ).toHaveTextContent('7');
    expect(
      screen.getByTestId('incident-trends-by-kind-electrical'),
    ).toHaveTextContent('3');
  });
});

// @vitest-environment jsdom
// Épica Rubros SII — slice 4: dashboard card smoke tests.
//
// The card renders the anonymous rubro benchmark distribution from
// GET /api/sii/:projectId/rubro-benchmarks:
//   • hidden when the project has no rubro (available:false)
//   • honest es-CL below-threshold message with the required N
//   • eligible: own value vs median / p25–p75 per metric
//   • never renders identifiers of other projects (response has none —
//     pinned server-side — but the card must not invent any either)

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { RubroBenchmarksCard } from './RubroBenchmarksCard';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string, opts?: Record<string, unknown>) => {
      let out = fallback ?? _k;
      for (const [key, val] of Object.entries(opts ?? {})) {
        out = out.replaceAll(`{{${key}}}`, String(val));
      }
      return out;
    },
  }),
}));

vi.mock('../../contexts/ProjectContext', () => ({
  useProject: () => ({ selectedProject: { id: 'proj-1', name: 'Faena Norte' } }),
}));

vi.mock('../../lib/apiAuth', () => ({
  apiAuthHeaders: async () => ({ Authorization: 'Bearer test' }),
}));

const fetchMock = vi.fn();

function mockResponse(body: unknown, ok = true) {
  fetchMock.mockResolvedValue({
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

describe('<RubroBenchmarksCard />', () => {
  it('no renderiza nada cuando el proyecto no tiene rubro', async () => {
    mockResponse({ available: false, reason: 'sin_rubro' });
    const { container } = render(<RubroBenchmarksCard />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/sii/proj-1/rubro-benchmarks',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer test' }) }),
    );
    await waitFor(() => expect(container.firstChild).toBeNull());
  });

  it('no renderiza nada si el endpoint falla (best-effort, sin romper el dashboard)', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    const { container } = render(<RubroBenchmarksCard />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await waitFor(() => expect(container.firstChild).toBeNull());
  });

  it('bajo el umbral muestra el mensaje honesto con el N requerido', async () => {
    mockResponse({
      available: true,
      eligible: false,
      requiredProjects: 5,
      requiredTenants: 3,
      rubro: { siiCode: 11101, descripcion: 'CULTIVO DE TRIGO', sectorId: 'GP-AGR-CULT' },
      mine: { incidentes12m: 1, hallazgosAbiertosPct: 50, obligacionesAlDiaPct: 100 },
    });
    render(<RubroBenchmarksCard />);
    await screen.findByText(/Aún no hay suficientes proyectos de tu rubro/);
    expect(
      screen.getByText(/se requieren al menos 5/),
    ).toBeInTheDocument();
    expect(screen.getByText(/CULTIVO DE TRIGO/)).toBeInTheDocument();
    // no distribution leaks below threshold
    expect(screen.queryByText(/Mediana/)).toBeNull();
  });

  it('sobre el umbral muestra tu valor vs mediana y rango p25–p75', async () => {
    mockResponse({
      available: true,
      eligible: true,
      requiredProjects: 5,
      requiredTenants: 3,
      rubro: { siiCode: 11101, descripcion: 'CULTIVO DE TRIGO', sectorId: 'GP-AGR-CULT' },
      mine: { incidentes12m: 1, hallazgosAbiertosPct: 50, obligacionesAlDiaPct: null },
      k: 7,
      kTenants: 4,
      perMetric: {
        incidentes12m: { count: 7, median: 3, p25: 2, p75: 4 },
        hallazgosAbiertosPct: { count: 6, median: 40, p25: 25, p75: 60 },
        obligacionesAlDiaPct: null,
      },
    });
    render(<RubroBenchmarksCard />);
    await screen.findByText(/CULTIVO DE TRIGO/);
    expect(screen.getByText('Incidentes (últimos 12 meses)')).toBeInTheDocument();
    expect(screen.getByTestId('rubro-benchmark-mine-incidentes12m')).toHaveTextContent('1');
    expect(screen.getByTestId('rubro-benchmark-median-incidentes12m')).toHaveTextContent('3');
    expect(screen.getByTestId('rubro-benchmark-range-incidentes12m')).toHaveTextContent('2–4');
    // suppressed metric renders the honest no-data marker, not a number
    expect(screen.getByTestId('rubro-benchmark-median-obligacionesAlDiaPct')).toHaveTextContent('s/d');
    // anonymous: the sample size is shown, no project names beyond our own
    expect(screen.getByText(/7 proyectos/)).toBeInTheDocument();
  });
});

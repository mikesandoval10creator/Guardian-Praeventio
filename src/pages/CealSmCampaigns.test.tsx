// @vitest-environment jsdom
//
// Praeventio Guard — page wrapper tests for <CealSmCampaigns /> (CEAL-SM/
// SUSESO campaign management). Hermetic: hooks/useCealSm + ProjectContext
// mocked. Mocked payload shapes mirror the REAL server contracts
// (src/server/routes/cealSm.ts) and engine result
// (src/services/protocols/cealSm.ts).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { CealSmCampaigns } from './CealSmCampaigns';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, fallback?: unknown) => {
      if (typeof fallback === 'string') return fallback;
      if (fallback && typeof fallback === 'object' && 'defaultValue' in (fallback as Record<string, unknown>)) {
        let out = String((fallback as Record<string, unknown>).defaultValue);
        for (const [key, val] of Object.entries(fallback as Record<string, unknown>)) {
          out = out.replace(`{{${key}}}`, String(val));
        }
        return out;
      }
      return k;
    },
  }),
}));

let mockSelectedProject: { id: string; name: string } | null = null;
vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => ({ selectedProject: mockSelectedProject }),
}));

const createMock = vi.fn();
const listMock = vi.fn();
const resultsMock = vi.fn();
vi.mock('../hooks/useCealSm', () => ({
  createCealCampaign: (...args: unknown[]) => createMock(...args),
  listCealCampaigns: (...args: unknown[]) => listMock(...args),
  getCealResults: (...args: unknown[]) => resultsMock(...args),
}));

const campaignSummary = {
  id: 'c-1',
  title: 'Evaluación CEAL-SM 2026',
  status: 'open' as const,
  openAt: '2026-06-01T00:00:00.000Z',
  closeAt: '2026-07-01T00:00:00.000Z',
  totalWorkers: 30,
  createdAt: '2026-06-01T00:00:00.000Z',
  responseCount: 12,
  participationRate: 0.4,
  hasResponded: false,
};

const dimensionAggregates = [
  'CT', 'EM', 'DP', 'RC', 'CR', 'QL', 'CM', 'IT', 'TV', 'CJ', 'VU', 'VA',
].map((id) => ({
  dimensionId: id,
  name: `Dimensión ${id}`,
  counts: { bajo: 2, medio: 4, alto: 6 },
  percentages: { bajo: 16.7, medio: 33.3, alto: 50 },
  centerPoints: 2,
}));

const fullResults = {
  campaignId: 'c-1',
  title: campaignSummary.title,
  status: 'open' as const,
  openAt: campaignSummary.openAt,
  closeAt: campaignSummary.closeAt,
  totalWorkers: 30,
  totalResponses: 12,
  participationRate: 0.4,
  insufficientResponses: false,
  result: {
    totalResponses: 12,
    totalWorkers: 30,
    participationRate: 0.4,
    evaluationValid: false,
    dimensions: dimensionAggregates,
    centerScore: 24,
    centerRisk: 'alto' as const,
    requiredActions: [
      'Riesgo alto: el centro de trabajo ingresa al programa de vigilancia ambiental del organismo administrador (OAL/AD).',
      'Reevaluar con CEAL-SM/SUSESO a los 2 años.',
    ],
    reevaluationYears: 2,
  },
};

function renderPage() {
  return render(
    <MemoryRouter>
      <CealSmCampaigns />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
  createMock.mockReset().mockResolvedValue({ id: 'c-new' });
  listMock.mockReset().mockResolvedValue({ campaigns: [campaignSummary] });
  resultsMock.mockReset().mockResolvedValue(fullResults);
});

describe('<CealSmCampaigns /> page (CEAL-SM/SUSESO)', () => {
  it('renderiza el empty-state cuando no hay proyecto seleccionado', () => {
    mockSelectedProject = null;
    renderPage();
    expect(screen.getByTestId('ceal-page-empty')).toBeInTheDocument();
  });

  it('renderiza marco legal, nota de anonimato y la lista de campañas con participación', async () => {
    renderPage();
    expect(screen.getByTestId('ceal-legal-frame')).toBeInTheDocument();
    expect(screen.getByTestId('ceal-anonymity-note')).toBeInTheDocument();
    expect(await screen.findByTestId('ceal-campaign-item-c-1')).toBeInTheDocument();
    expect(screen.getByText(/12\/30/)).toBeInTheDocument();
    expect(screen.getByText(/<60%/)).toBeInTheDocument();
    await waitFor(() => expect(listMock).toHaveBeenCalledWith('p-1'));
  });

  it('seleccionar campaña carga resultados: semáforo de 12 dimensiones + veredicto + acciones', async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId('ceal-campaign-item-c-1'));
    await waitFor(() => expect(resultsMock).toHaveBeenCalledWith('p-1', 'c-1'));
    expect(await screen.findByTestId('ceal-center-badge')).toHaveTextContent(
      'ceal_sm.center_risk_alto',
    );
    for (const id of ['CT', 'EM', 'DP', 'RC', 'CR', 'QL', 'CM', 'IT', 'TV', 'CJ', 'VU', 'VA']) {
      expect(screen.getByTestId(`ceal-dim-${id}`)).toBeInTheDocument();
    }
    expect(screen.getByTestId('ceal-validity-badge')).toHaveTextContent(/<60%/);
    expect(screen.getByText(/vigilancia ambiental/)).toBeInTheDocument();
    expect(screen.getByText(/2 años/)).toBeInTheDocument();
  });

  it('bajo el umbral de anonimato muestra la supresión en vez de agregados', async () => {
    resultsMock.mockResolvedValue({
      ...fullResults,
      totalResponses: 7,
      insufficientResponses: true,
      threshold: 10,
      result: null,
    });
    renderPage();
    fireEvent.click(await screen.findByTestId('ceal-campaign-item-c-1'));
    expect(await screen.findByTestId('ceal-results-suppressed')).toBeInTheDocument();
    expect(screen.queryByTestId('ceal-center-badge')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ceal-semaforo')).not.toBeInTheDocument();
  });

  it('crear campaña exige datos completos y llama al mutador con ISO + dotación', async () => {
    renderPage();
    fireEvent.click(screen.getByTestId('ceal-new-campaign-btn'));
    // Incomplete → validation error, no remote call.
    fireEvent.click(screen.getByTestId('ceal-create-btn'));
    expect(await screen.findByTestId('ceal-error')).toBeInTheDocument();
    expect(createMock).not.toHaveBeenCalled();

    fireEvent.change(screen.getByTestId('ceal-title-input'), {
      target: { value: 'Campaña 2026' },
    });
    fireEvent.change(screen.getByTestId('ceal-openat-input'), {
      target: { value: '2026-06-15' },
    });
    fireEvent.change(screen.getByTestId('ceal-closeat-input'), {
      target: { value: '2026-07-15' },
    });
    fireEvent.change(screen.getByTestId('ceal-workers-input'), {
      target: { value: '45' },
    });
    listMock.mockClear();
    fireEvent.click(screen.getByTestId('ceal-create-btn'));
    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    expect(createMock).toHaveBeenCalledWith('p-1', {
      title: 'Campaña 2026',
      openAt: '2026-06-15T00:00:00.000Z',
      closeAt: '2026-07-15T23:59:59.999Z',
      totalWorkers: 45,
    });
    await waitFor(() => expect(listMock).toHaveBeenCalled());
  });

  it('muestra el mensaje de rol cuando el server responde forbidden_role', async () => {
    createMock.mockRejectedValue(new Error('forbidden_role'));
    renderPage();
    fireEvent.click(screen.getByTestId('ceal-new-campaign-btn'));
    fireEvent.change(screen.getByTestId('ceal-title-input'), {
      target: { value: 'Campaña 2026' },
    });
    fireEvent.change(screen.getByTestId('ceal-openat-input'), {
      target: { value: '2026-06-15' },
    });
    fireEvent.change(screen.getByTestId('ceal-closeat-input'), {
      target: { value: '2026-07-15' },
    });
    fireEvent.change(screen.getByTestId('ceal-workers-input'), {
      target: { value: '45' },
    });
    fireEvent.click(screen.getByTestId('ceal-create-btn'));
    expect(await screen.findByTestId('ceal-error')).toHaveTextContent(/prevencionista/);
  });
});

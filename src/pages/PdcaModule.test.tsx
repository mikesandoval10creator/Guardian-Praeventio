// @vitest-environment jsdom
//
// Praeventio Guard — Sprint K §195-200 page wrapper tests.
//
// Smoke tests for `<PdcaModule />`. Hermetic — mocks the Sprint K hooks
// and contexts so no Firestore / no fetch is touched.
//
// Coverage:
//   1. Empty state (no project selected)
//   2. Loading state (hooks streaming)
//   3. Error state (hook surfaces error)
//   4. Kanban render — 4 columns with grouped cycles
//   5. Advance phase modal opens on cycle click + calls mutation
//   6. NC linkage: card shows NC description when linked
//   7. Summary card displays closure rate %

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PdcaModule } from './PdcaModule';

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

let mockSelectedProject: { id: string; name: string } | null = null;
let mockIsOnline = true;

type FetchMock<T> = {
  data: T | null;
  loading: boolean;
  error: Error | null;
  refetch?: () => void;
};

let mockCyclesResp: FetchMock<{
  cycles: Array<{
    id: string;
    currentStage: 'plan' | 'do' | 'check' | 'act';
    stages: Array<{
      kind: 'plan' | 'do' | 'check' | 'act';
      activityId: string;
      notes: string;
      ownerUid: string;
      startedAt: string;
    }>;
    cycleNumber: number;
    nonConformityId?: string;
    origin?: 'audit' | 'incident' | 'finding' | 'inspection';
  }>;
}>;
let mockSummaryResp: FetchMock<{
  summary: {
    total: number;
    byPhase: Record<'plan' | 'do' | 'check' | 'act', number>;
    closedCycles: number;
    closureRate: number;
  };
}>;
let mockNcResp: FetchMock<{
  nonConformities: Array<{
    id: string;
    category: string;
    severity: 'minor' | 'major' | 'critical';
    description: string;
    location: string;
    detectedAt: string;
    responsibleUid: string;
    status: 'open' | 'in_progress' | 'closed' | 'verified_effective' | 'reoccurred';
  }>;
}>;

const advancePdcaPhaseMock = vi.fn();
const createPdcaCycleMock = vi.fn();
const createPdcaNonConformityMock = vi.fn();

vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => ({ selectedProject: mockSelectedProject }),
}));
vi.mock('../hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => mockIsOnline,
}));
vi.mock('../hooks/useSprintK', () => ({
  usePdcaCycles: () => mockCyclesResp,
  usePdcaSummary: () => mockSummaryResp,
  usePdcaNonConformities: () => mockNcResp,
  advancePdcaPhase: (...args: unknown[]) => advancePdcaPhaseMock(...args),
  createPdcaCycle: (...args: unknown[]) => createPdcaCycleMock(...args),
  createPdcaNonConformity: (...args: unknown[]) =>
    createPdcaNonConformityMock(...args),
}));

beforeEach(() => {
  mockSelectedProject = null;
  mockIsOnline = true;
  mockCyclesResp = { data: null, loading: false, error: null, refetch: vi.fn() };
  mockSummaryResp = {
    data: null,
    loading: false,
    error: null,
    refetch: vi.fn(),
  };
  mockNcResp = { data: null, loading: false, error: null, refetch: vi.fn() };
  advancePdcaPhaseMock.mockReset();
  createPdcaCycleMock.mockReset();
  createPdcaNonConformityMock.mockReset();
});

describe('<PdcaModule /> page wrapper (Sprint K §195-200)', () => {
  it('renderiza el empty-state cuando no hay proyecto seleccionado', () => {
    mockSelectedProject = null;
    render(<PdcaModule />);
    expect(screen.getByTestId('pdca-module-empty')).toBeInTheDocument();
    expect(screen.getByText(/selecciona un proyecto/i)).toBeInTheDocument();
  });

  it('renderiza loading mientras el hook trae datos', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockCyclesResp = {
      data: null,
      loading: true,
      error: null,
      refetch: vi.fn(),
    };
    render(<PdcaModule />);
    expect(screen.getByTestId('pdca-module-loading')).toBeInTheDocument();
  });

  it('renderiza error con el mensaje del hook', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockCyclesResp = {
      data: null,
      loading: false,
      error: new Error('Network down'),
      refetch: vi.fn(),
    };
    render(<PdcaModule />);
    expect(screen.getByTestId('pdca-module-error')).toBeInTheDocument();
    expect(screen.getByText(/Network down/i)).toBeInTheDocument();
  });

  it('renderiza el kanban con 4 columnas (P/D/C/A) y agrupa ciclos por fase', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockCyclesResp = {
      data: {
        cycles: [
          {
            id: 'pdca_1',
            currentStage: 'plan',
            stages: [
              {
                kind: 'plan',
                activityId: 'pdca_1-cycle-1-plan',
                notes: '',
                ownerUid: 'u1',
                startedAt: '2026-05-01T00:00:00.000Z',
              },
            ],
            cycleNumber: 1,
            origin: 'audit',
          },
          {
            id: 'pdca_2',
            currentStage: 'check',
            stages: [
              {
                kind: 'plan',
                activityId: 'pdca_2-cycle-1-plan',
                notes: '',
                ownerUid: 'u1',
                startedAt: '2026-05-01T00:00:00.000Z',
              },
            ],
            cycleNumber: 1,
            origin: 'incident',
          },
        ],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    };
    render(<PdcaModule />);
    expect(screen.getByTestId('pdca-kanban-board')).toBeInTheDocument();
    expect(screen.getByTestId('pdca-kanban-column-plan')).toBeInTheDocument();
    expect(screen.getByTestId('pdca-kanban-column-do')).toBeInTheDocument();
    expect(screen.getByTestId('pdca-kanban-column-check')).toBeInTheDocument();
    expect(screen.getByTestId('pdca-kanban-column-act')).toBeInTheDocument();
    expect(screen.getByTestId('pdca-card-pdca_1')).toBeInTheDocument();
    expect(screen.getByTestId('pdca-card-pdca_2')).toBeInTheDocument();
  });

  it('al hacer click en una card abre el modal y permite avanzar fase con evidencia', async () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockCyclesResp = {
      data: {
        cycles: [
          {
            id: 'pdca_1',
            currentStage: 'plan',
            stages: [
              {
                kind: 'plan',
                activityId: 'pdca_1-cycle-1-plan',
                notes: 'notas plan',
                ownerUid: 'u1',
                startedAt: '2026-05-01T00:00:00.000Z',
              },
            ],
            cycleNumber: 1,
            origin: 'audit',
          },
        ],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    };
    advancePdcaPhaseMock.mockResolvedValue({
      id: 'pdca_1',
      currentStage: 'do',
      stages: [],
      cycleNumber: 1,
    });
    render(<PdcaModule />);
    fireEvent.click(screen.getByTestId('pdca-card-pdca_1'));
    expect(screen.getByTestId('pdca-detail-modal')).toBeInTheDocument();
    expect(screen.getByTestId('pdca-stage-history')).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('pdca-evidence-input'), {
      target: { value: 'storage://foto1.jpg' },
    });
    fireEvent.click(screen.getByTestId('pdca-advance-button'));
    // Wait one microtask for async handler.
    await Promise.resolve();
    expect(advancePdcaPhaseMock).toHaveBeenCalledWith(
      'p-1',
      'pdca_1',
      expect.objectContaining({ evidence: ['storage://foto1.jpg'] }),
    );
  });

  it('muestra la descripción de la NC vinculada en la card del ciclo', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockCyclesResp = {
      data: {
        cycles: [
          {
            id: 'pdca_1',
            currentStage: 'plan',
            stages: [
              {
                kind: 'plan',
                activityId: 'pdca_1-cycle-1-plan',
                notes: '',
                ownerUid: 'u1',
                startedAt: '2026-05-01T00:00:00.000Z',
              },
            ],
            cycleNumber: 1,
            origin: 'audit',
            nonConformityId: 'nc_critical',
          },
        ],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    };
    mockNcResp = {
      data: {
        nonConformities: [
          {
            id: 'nc_critical',
            category: 'EPP',
            severity: 'critical',
            description: 'Falta guantes dieléctricos en cuadrilla eléctrica',
            location: 'Subestación Norte',
            detectedAt: '2026-05-01T00:00:00.000Z',
            responsibleUid: 'u1',
            status: 'open',
          },
        ],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    };
    render(<PdcaModule />);
    expect(
      screen.getByText(/Falta guantes dieléctricos/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Subestación Norte/i)).toBeInTheDocument();
  });

  it('renderiza el closure rate en la card de cierre', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockCyclesResp = {
      data: { cycles: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    };
    mockSummaryResp = {
      data: {
        summary: {
          total: 10,
          byPhase: { plan: 3, do: 2, check: 2, act: 3 },
          closedCycles: 4,
          closureRate: 40,
        },
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    };
    render(<PdcaModule />);
    const closure = screen.getByTestId('pdca-summary-closure');
    expect(closure).toBeInTheDocument();
    expect(closure.textContent ?? '').toMatch(/40%/);
    expect(closure.textContent ?? '').toMatch(/4 \/ 10/);
  });
});

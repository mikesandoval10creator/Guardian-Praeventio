// @vitest-environment jsdom
//
// Praeventio Guard — Sprint K §131-138 page wrapper tests.
//
// Smoke tests for `<ProjectClosure />`:
//   1. Empty state when no project selected.
//   2. Loading state from hooks.
//   3. Error state surfaces error message.
//   4. Readiness 0% renders + finalize button disabled.
//   5. Readiness 100% + admin enables finalize button.
//   6. Capture lesson form invokes mutation.
//   7. Log decision form invokes mutation.
//
// The component mocks Sprint K hooks + project/online/firebase contexts so
// the test is hermetic — no Firestore, no fetch.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ProjectClosure } from './ProjectClosure';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>, opts?: Record<string, unknown>) => {
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

type ClosureStateMock = {
  status: 'open' | 'initiated' | 'finalized';
  initiatedAt: string | null;
  initiatedByUid: string | null;
  finalizedAt: string | null;
  finalizedByUid: string | null;
};

type StatusResp = {
  data: {
    state: ClosureStateMock;
    readinessPercent: number;
    canClose: boolean;
    blockers: string[];
    warnings: string[];
    pending: {
      openIncidents: number;
      openActions: number;
      openPermits: number;
      lessonsCaptured: number;
      decisionsLogged: number;
    };
  } | null;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
};

type SummaryResp = {
  data: {
    summary: {
      audience: 'management' | 'client' | 'operations' | 'regulatory';
      highlights: Array<{ label: string; value: string }>;
      narrative: string;
    };
    role: string;
    audience: string;
    counts: {
      lessons: number;
      decisions: number;
      incidents: number;
      criticalIncidents: number;
    };
  } | null;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
};

let mockSelectedProject: { id: string; name: string } | null = null;
let mockIsOnline = true;
let mockIsAdmin = false;
let mockStatus: StatusResp;
let mockSummary: SummaryResp;
const captureLessonMock = vi.fn();
const logDecisionMock = vi.fn();
const initiateClosureMock = vi.fn();
const finalizeClosureMock = vi.fn();

vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => ({ selectedProject: mockSelectedProject }),
}));
vi.mock('../hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => mockIsOnline,
}));
vi.mock('../contexts/FirebaseContext', () => ({
  useFirebase: () => ({ isAdmin: mockIsAdmin }),
}));
vi.mock('../hooks/useProjectClosure', () => ({
  useClosureStatus: () => mockStatus,
  useClosureSummary: () => mockSummary,
  initiateClosure: (...args: unknown[]) => initiateClosureMock(...args),
  captureLesson: (...args: unknown[]) => captureLessonMock(...args),
  logDecision: (...args: unknown[]) => logDecisionMock(...args),
  finalizeClosure: (...args: unknown[]) => finalizeClosureMock(...args),
}));

beforeEach(() => {
  mockSelectedProject = null;
  mockIsOnline = true;
  mockIsAdmin = false;
  mockStatus = {
    data: null,
    loading: false,
    error: null,
    refetch: vi.fn(),
  };
  mockSummary = {
    data: null,
    loading: false,
    error: null,
    refetch: vi.fn(),
  };
  captureLessonMock.mockReset();
  captureLessonMock.mockResolvedValue({
    id: 'cl_new',
    summary: 'Test lesson',
    preventiveAction: 'Test action',
    riskCategories: [],
    tags: [],
    industry: 'construccion',
    capturedAt: '2026-05-17T00:00:00.000Z',
    capturedByUid: 'user-1',
    publishedLessonId: 'pub_cl_new',
  });
  logDecisionMock.mockReset();
  logDecisionMock.mockResolvedValue({
    id: 'cd_new',
    decidedAt: '2026-05-17T00:00:00.000Z',
    context: 'Test ctx',
    decision: 'Test dec',
    decidedByUid: 'user-1',
    outcome: 'positive',
    loggedAt: '2026-05-17T00:00:00.000Z',
    loggedByUid: 'user-1',
  });
  initiateClosureMock.mockReset();
  initiateClosureMock.mockResolvedValue({
    status: 'initiated',
    initiatedAt: '2026-05-17T00:00:00.000Z',
    initiatedByUid: 'user-1',
    finalizedAt: null,
    finalizedByUid: null,
  });
  finalizeClosureMock.mockReset();
  finalizeClosureMock.mockResolvedValue({
    status: 'finalized',
    initiatedAt: '2026-05-17T00:00:00.000Z',
    initiatedByUid: 'user-1',
    finalizedAt: '2026-05-17T01:00:00.000Z',
    finalizedByUid: 'admin-1',
  });
});

function fullStatus(over: Partial<StatusResp['data']> & {} = {}): StatusResp {
  return {
    data: {
      state: {
        status: 'open',
        initiatedAt: null,
        initiatedByUid: null,
        finalizedAt: null,
        finalizedByUid: null,
      },
      readinessPercent: 0,
      canClose: false,
      blockers: [],
      warnings: [],
      pending: {
        openIncidents: 0,
        openActions: 0,
        openPermits: 0,
        lessonsCaptured: 0,
        decisionsLogged: 0,
      },
      ...over,
    },
    loading: false,
    error: null,
    refetch: vi.fn(),
  };
}

function fullSummary(): SummaryResp {
  return {
    data: {
      summary: {
        audience: 'management',
        highlights: [
          { label: 'Compliance score promedio', value: '85/100' },
          { label: 'Incidentes / Críticos', value: '5 / 1' },
        ],
        narrative: 'Resumen de gerencia para el proyecto.',
      },
      role: 'gerencia',
      audience: 'management',
      counts: { lessons: 2, decisions: 3, incidents: 5, criticalIncidents: 1 },
    },
    loading: false,
    error: null,
    refetch: vi.fn(),
  };
}

describe('<ProjectClosure /> page wrapper (Sprint K §131-138)', () => {
  it('renderiza el empty-state cuando no hay proyecto seleccionado', () => {
    mockSelectedProject = null;
    render(<ProjectClosure />);
    expect(screen.getByTestId('project-closure-page-empty')).toBeInTheDocument();
    expect(screen.getByText(/selecciona un proyecto/i)).toBeInTheDocument();
  });

  it('renderiza loading mientras los hooks traen datos', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockStatus = { data: null, loading: true, error: null, refetch: vi.fn() };
    render(<ProjectClosure />);
    expect(screen.getByTestId('project-closure-loading')).toBeInTheDocument();
  });

  it('muestra error con el mensaje del hook', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockStatus = {
      data: null,
      loading: false,
      error: new Error('Network down'),
      refetch: vi.fn(),
    };
    render(<ProjectClosure />);
    expect(screen.getByTestId('project-closure-error')).toBeInTheDocument();
    expect(screen.getByText(/Network down/i)).toBeInTheDocument();
  });

  it('readiness 0% con bloqueadores muestra el botón finalize deshabilitado', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockStatus = fullStatus({
      readinessPercent: 0,
      canClose: false,
      blockers: ['3 incidente(s) abierto(s).'],
      pending: {
        openIncidents: 3,
        openActions: 0,
        openPermits: 0,
        lessonsCaptured: 0,
        decisionsLogged: 0,
      },
    });
    mockSummary = fullSummary();
    render(<ProjectClosure />);
    expect(screen.getByTestId('project-closure-readiness-percent')).toHaveTextContent('0%');
    const btn = screen.getByTestId('project-closure-finalize-btn') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(screen.getByText(/3 incidente\(s\) abierto/i)).toBeInTheDocument();
  });

  it('readiness 100% + admin habilita el botón finalize', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockIsAdmin = true;
    mockStatus = fullStatus({
      readinessPercent: 100,
      canClose: true,
      blockers: [],
      warnings: [],
      pending: {
        openIncidents: 0,
        openActions: 0,
        openPermits: 0,
        lessonsCaptured: 4,
        decisionsLogged: 2,
      },
    });
    mockSummary = fullSummary();
    render(<ProjectClosure />);
    expect(screen.getByTestId('project-closure-readiness-percent')).toHaveTextContent('100%');
    const btn = screen.getByTestId('project-closure-finalize-btn') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    expect(screen.getByText(/sin bloqueadores ni advertencias/i)).toBeInTheDocument();
  });

  it('captura una lección llamando al mutation', async () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockStatus = fullStatus();
    mockSummary = fullSummary();
    render(<ProjectClosure />);
    fireEvent.change(screen.getByTestId('project-closure-lesson-summary'), {
      target: { value: 'Reasignar cuadrilla por fatiga acumulada' },
    });
    fireEvent.change(screen.getByTestId('project-closure-lesson-action'), {
      target: { value: 'Cambio de turno preventivo cada 4 horas' },
    });
    fireEvent.click(screen.getByTestId('project-closure-lesson-submit'));
    await waitFor(() => {
      expect(captureLessonMock).toHaveBeenCalledTimes(1);
    });
    expect(captureLessonMock).toHaveBeenCalledWith(
      'p-1',
      expect.objectContaining({
        summary: 'Reasignar cuadrilla por fatiga acumulada',
        preventiveAction: 'Cambio de turno preventivo cada 4 horas',
      }),
    );
  });

  it('registra una decisión crítica llamando al mutation', async () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockStatus = fullStatus();
    mockSummary = fullSummary();
    render(<ProjectClosure />);
    fireEvent.change(screen.getByTestId('project-closure-decision-context'), {
      target: { value: 'Trabajos en altura con viento sobre 40 km/h' },
    });
    fireEvent.change(screen.getByTestId('project-closure-decision-text'), {
      target: { value: 'Suspender hasta condiciones mejoren' },
    });
    fireEvent.click(screen.getByTestId('project-closure-decision-submit'));
    await waitFor(() => {
      expect(logDecisionMock).toHaveBeenCalledTimes(1);
    });
    expect(logDecisionMock).toHaveBeenCalledWith(
      'p-1',
      expect.objectContaining({
        context: 'Trabajos en altura con viento sobre 40 km/h',
        decision: 'Suspender hasta condiciones mejoren',
        outcome: 'positive',
      }),
    );
  });
});

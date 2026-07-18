// @vitest-environment jsdom
//
// Praeventio Guard — Fase F.16 page wrapper tests.
//
// Smoke tests for `<WorkerReadiness />`:
//   1. Empty state when no project is selected.
//   2. Empty state when no worker is selected (project ready, awaiting input).
//   3. Loading state while the hook fetches.
//   4. Error state surfaces the hook's message.
//   5. High-score render: shows score, level, sub-score bars, no attention banner.
//   6. Low-score render: attention banner visible + blockers list rendered.
//
// Hermetic — mocks react-i18next, useProject, useOnlineStatus,
// useFirestoreCollection (worker autocomplete), and useSprintK
// (useWorkerReadiness). No Firestore, no fetch.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WorkerReadiness } from './WorkerReadiness';
import type { ReadinessReport } from '../services/workerReadiness/readinessScore';
import type { WorkerReadinessResponse } from '../hooks/useWorkerReadiness';

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
let mockWorkers: Array<{
  id: string;
  name?: string;
  email?: string;
  role?: string;
}> = [];
let mockReadiness: {
  data: WorkerReadinessResponse | null;
  loading: boolean;
  error: Error | null;
  refetch?: () => void;
};

vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => ({ selectedProject: mockSelectedProject }),
}));
vi.mock('../hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => mockIsOnline,
}));
vi.mock('../hooks/useFirestoreCollection', () => ({
  // Page calls useFirestoreCollection twice: once for workers, once for
  // tasks. We dispatch by path so the worker selector populates and the
  // task selector stays empty in these smoke tests.
  useFirestoreCollection: (path: string | null) => {
    if (path && path.endsWith('/workers')) {
      return { data: mockWorkers, loading: false, error: null };
    }
    return { data: [], loading: false, error: null };
  },
}));
vi.mock('../hooks/useWorkerReadiness', () => ({
  useWorkerReadiness: (
    _pid: string | null,
    workerUid: string | null,
  ): {
    data: WorkerReadinessResponse | null;
    loading: boolean;
    error: Error | null;
    refetch?: () => void;
  } => {
    // No worker selected → idle, never fetched. Matches the hook's
    // internal guard in useEndpoint (path === null → loading=false).
    if (!workerUid) return { data: null, loading: false, error: null };
    return mockReadiness;
  },
}));

function makeReport(overrides: Partial<ReadinessReport> = {}): ReadinessReport {
  return {
    workerUid: 'w-1',
    taskCategory: 'altura',
    score: 92,
    level: 'ready',
    gaps: [],
    recommendations: [],
    subScores: {
      trainings: 25,
      epp: 20,
      medical: 15,
      documents: 10,
      experience: 15,
      fatigue: 15,
    },
    ...overrides,
  };
}

beforeEach(() => {
  mockSelectedProject = null;
  mockIsOnline = true;
  mockWorkers = [];
  mockReadiness = { data: null, loading: false, error: null };
});

describe('<WorkerReadiness /> page wrapper (Fase F.16)', () => {
  it('renderiza empty-state cuando no hay proyecto', () => {
    mockSelectedProject = null;
    render(<WorkerReadiness />);
    expect(screen.getByTestId('worker-readiness-page-empty')).toBeInTheDocument();
    expect(screen.getByText(/selecciona un proyecto/i)).toBeInTheDocument();
  });

  it('renderiza empty-state cuando no hay trabajador seleccionado', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockWorkers = [
      { id: 'w-1', name: 'Juan Pérez', role: 'electricista' },
    ];
    render(<WorkerReadiness />);
    expect(screen.getByTestId('worker-readiness-page')).toBeInTheDocument();
    expect(screen.getByTestId('worker-readiness-empty')).toBeInTheDocument();
  });

  it('renderiza loading mientras el hook trae datos', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockWorkers = [{ id: 'w-1', name: 'Juan Pérez' }];
    mockReadiness = { data: null, loading: true, error: null };

    render(<WorkerReadiness />);
    // Drive the page through worker selection so the hook gate opens.
    fireEvent.change(screen.getByTestId('worker-readiness-select'), {
      target: { value: 'w-1' },
    });
    expect(screen.getByTestId('worker-readiness-loading')).toBeInTheDocument();
  });

  it('muestra error con el mensaje del hook', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockWorkers = [{ id: 'w-1', name: 'Juan Pérez' }];
    mockReadiness = {
      data: null,
      loading: false,
      error: new Error('Network down'),
    };

    render(<WorkerReadiness />);
    fireEvent.change(screen.getByTestId('worker-readiness-select'), {
      target: { value: 'w-1' },
    });
    expect(screen.getByTestId('worker-readiness-error')).toBeInTheDocument();
    expect(screen.getByText(/conectar con el servidor/i)).toBeInTheDocument();
  });

  it('renderiza score alto: muestra valor, nivel y barras, SIN banner de atención', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockWorkers = [{ id: 'w-1', name: 'Juan Pérez' }];
    mockReadiness = {
      data: { report: makeReport({ score: 92, level: 'ready' }) },
      loading: false,
      error: null,
    };

    render(<WorkerReadiness />);
    fireEvent.change(screen.getByTestId('worker-readiness-select'), {
      target: { value: 'w-1' },
    });

    expect(screen.getByTestId('worker-readiness-report')).toBeInTheDocument();
    expect(screen.getByTestId('worker-readiness-score-value')).toHaveTextContent(
      '92',
    );
    expect(screen.getByTestId('worker-readiness-level')).toHaveTextContent(
      /Preparado/i,
    );
    expect(screen.getByTestId('worker-readiness-bar-training')).toBeInTheDocument();
    expect(screen.getByTestId('worker-readiness-bar-epp')).toBeInTheDocument();
    expect(screen.getByTestId('worker-readiness-bar-fatigue')).toBeInTheDocument();
    expect(screen.getByTestId('worker-readiness-bar-history')).toBeInTheDocument();
    expect(
      screen.queryByTestId('worker-readiness-attention-banner'),
    ).not.toBeInTheDocument();
  });

  it('renderiza score bajo: muestra banner ámbar (no-bloqueante) Y la lista de brechas', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockWorkers = [{ id: 'w-1', name: 'Juan Pérez' }];
    mockReadiness = {
      data: {
        report: makeReport({
          score: 42,
          level: 'major_gaps',
          gaps: [
            {
              kind: 'medical_aptitude',
              description: 'Aptitud médica EXPIRADA — agendar examen ocupacional.',
              weight: 12,
              recommendation: 'Agendar examen ocupacional inmediatamente.',
            },
            {
              kind: 'fatigue',
              description: 'Fatiga alta — riesgo aumentado.',
              weight: 12,
              recommendation: 'Reasignar a tarea menos exigente.',
            },
          ],
          recommendations: [
            'Agendar examen ocupacional inmediatamente.',
            'Reasignar a tarea menos exigente.',
          ],
          subScores: {
            trainings: 25,
            epp: 20,
            medical: 3,
            documents: 10,
            experience: 12,
            fatigue: 3,
          },
        }),
      },
      loading: false,
      error: null,
    };

    render(<WorkerReadiness />);
    fireEvent.change(screen.getByTestId('worker-readiness-select'), {
      target: { value: 'w-1' },
    });

    // Banner is visible because score < 60.
    const banner = screen.getByTestId('worker-readiness-attention-banner');
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveTextContent(/Requiere atención del supervisor/i);
    // Non-blocking subtitle reaffirms the directive.
    expect(banner).toHaveTextContent(/no bloquea/i);

    // Blockers list rendered with the two weight≥10 gaps.
    const blockers = screen.getByTestId('worker-readiness-blockers');
    expect(blockers).toBeInTheDocument();
    expect(blockers).toHaveTextContent(/Aptitud médica EXPIRADA/i);
    expect(blockers).toHaveTextContent(/Fatiga alta/i);

    // Recommendations card too.
    const recs = screen.getByTestId('worker-readiness-recommendations');
    expect(recs).toBeInTheDocument();
    expect(recs).toHaveTextContent(/Agendar examen ocupacional/i);
  });
});

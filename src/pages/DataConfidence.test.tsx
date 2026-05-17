// @vitest-environment jsdom
//
// Praeventio Guard — Sprint K §104 page wrapper tests.
//
// Smoke tests for `<DataConfidence />`:
//   1. Empty state when no project is selected.
//   2. Loading state from the hook.
//   3. Error state surfaces the message.
//   4. Render with low overall score → rose color band + red flags chip.
//   5. Render with high score + empty issues → empty hint visible.
//   6. Dismiss button calls `dismissDataIssue` (admin gated).
//
// Hermetic: hooks and contexts are mocked so the test has no fetch,
// no Firestore, no router state. Pattern matches `LeadershipDecisions
// .test.tsx` and `AnnualReview.test.tsx`.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DataConfidence } from './DataConfidence';
import type {
  DataConfidenceSnapshot,
  DataConfidenceRecommendationsResponse,
} from '../hooks/useSprintK';

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

type SnapshotResp = {
  data: DataConfidenceSnapshot | null;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
};
type RecosResp = {
  data: DataConfidenceRecommendationsResponse | null;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
};

let mockSelectedProject: { id: string; name: string } | null = null;
let mockIsOnline = true;
let mockIsAdmin = false;
let mockSnapshot: SnapshotResp;
let mockRecos: RecosResp;

const refetchMock = vi.fn();
const dismissMock = vi.fn();

vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => ({ selectedProject: mockSelectedProject }),
}));
vi.mock('../contexts/FirebaseContext', () => ({
  useFirebase: () => ({ isAdmin: mockIsAdmin }),
}));
vi.mock('../hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => mockIsOnline,
}));
vi.mock('../hooks/useSprintK', () => ({
  useDataConfidence: () => mockSnapshot,
  useDataConfidenceRecommendations: () => mockRecos,
  dismissDataIssue: (...args: unknown[]) => dismissMock(...args),
}));

function makeSnapshot(overrides: Partial<DataConfidenceSnapshot> = {}): DataConfidenceSnapshot {
  return {
    generatedAt: '2026-05-17T12:00:00.000Z',
    report: {
      generatedAt: '2026-05-17T12:00:00.000Z',
      overallScore: 85,
      overallLevel: 'high',
      dimensions: [],
      redFlags: [],
      recommendations: [],
    },
    domains: [
      {
        name: 'workers',
        score: 80,
        observed: 50,
        expected: 50,
        staleDays: 1,
        detail: 'Workers: 50/50.',
      },
      {
        name: 'incidents',
        score: 70,
        observed: 12,
        expected: 12,
        staleDays: 2,
        detail: 'Incidentes con RCA 10/12.',
      },
      {
        name: 'training',
        score: 75,
        observed: 30,
        expected: 30,
        staleDays: 3,
        detail: 'Capacitaciones con aprobador 25/30.',
      },
      {
        name: 'epp',
        score: 90,
        observed: 80,
        expected: 100,
        staleDays: 1,
        detail: 'EPP con vencimiento 78/80.',
      },
      {
        name: 'permits',
        score: 60,
        observed: 5,
        expected: 5,
        staleDays: 10,
        detail: 'Permisos con emisor 5/5.',
      },
      {
        name: 'audits',
        score: 50,
        observed: 3,
        expected: 3,
        staleDays: 30,
        detail: 'Auditorías con conclusión 2/3.',
      },
    ],
    topIssues: [],
    trend: [],
    ...overrides,
  };
}

beforeEach(() => {
  mockSelectedProject = null;
  mockIsOnline = true;
  mockIsAdmin = false;
  refetchMock.mockReset();
  dismissMock.mockReset();
  dismissMock.mockResolvedValue(undefined);
  mockSnapshot = {
    data: null,
    loading: false,
    error: null,
    refetch: refetchMock,
  };
  mockRecos = {
    data: { generatedAt: '2026-05-17T12:00:00.000Z', recommendations: [] },
    loading: false,
    error: null,
    refetch: refetchMock,
  };
});

describe('<DataConfidence /> page wrapper (Sprint K §104)', () => {
  it('renderiza empty-state cuando no hay proyecto seleccionado', () => {
    mockSelectedProject = null;
    render(<DataConfidence />);
    expect(screen.getByTestId('data-confidence-page-empty')).toBeInTheDocument();
    expect(screen.getByText(/selecciona un proyecto/i)).toBeInTheDocument();
  });

  it('renderiza loading mientras el hook está cargando', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockSnapshot = {
      data: null,
      loading: true,
      error: null,
      refetch: refetchMock,
    };
    render(<DataConfidence />);
    expect(screen.getByTestId('data-confidence-loading')).toBeInTheDocument();
  });

  it('muestra el mensaje del error del hook', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockSnapshot = {
      data: null,
      loading: false,
      error: new Error('Network down'),
      refetch: refetchMock,
    };
    render(<DataConfidence />);
    expect(screen.getByTestId('data-confidence-error')).toBeInTheDocument();
    expect(screen.getByText(/Network down/i)).toBeInTheDocument();
  });

  it('renderiza gauge con score bajo + bandera roja chip', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockSnapshot = {
      data: makeSnapshot({
        report: {
          generatedAt: '2026-05-17T12:00:00.000Z',
          overallScore: 25,
          overallLevel: 'critical',
          dimensions: [],
          redFlags: ['coverage: detalle', 'freshness: detalle'],
          recommendations: [],
        },
      }),
      loading: false,
      error: null,
      refetch: refetchMock,
    };
    render(<DataConfidence />);
    expect(screen.getByTestId('data-confidence-summary')).toBeInTheDocument();
    expect(screen.getByTestId('data-confidence-gauge-value')).toHaveTextContent(
      '25',
    );
    expect(screen.getByTestId('data-confidence-level')).toHaveTextContent(
      /crítico/i,
    );
    expect(
      screen.getByTestId('data-confidence-redflags-count'),
    ).toHaveTextContent('2');
    // Domain bars present for all 6 domains.
    expect(screen.getByTestId('data-confidence-domain-workers')).toBeInTheDocument();
    expect(screen.getByTestId('data-confidence-domain-incidents')).toBeInTheDocument();
    expect(screen.getByTestId('data-confidence-domain-training')).toBeInTheDocument();
    expect(screen.getByTestId('data-confidence-domain-epp')).toBeInTheDocument();
    expect(screen.getByTestId('data-confidence-domain-permits')).toBeInTheDocument();
    expect(screen.getByTestId('data-confidence-domain-audits')).toBeInTheDocument();
  });

  it('renderiza score alto + lista vacía de issues con hint', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockSnapshot = {
      data: makeSnapshot({
        report: {
          generatedAt: '2026-05-17T12:00:00.000Z',
          overallScore: 95,
          overallLevel: 'high',
          dimensions: [],
          redFlags: [],
          recommendations: [],
        },
        topIssues: [],
      }),
      loading: false,
      error: null,
      refetch: refetchMock,
    };
    render(<DataConfidence />);
    expect(screen.getByTestId('data-confidence-gauge-value')).toHaveTextContent(
      '95',
    );
    expect(
      screen.getByTestId('data-confidence-issues-empty'),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId('data-confidence-redflags-count'),
    ).not.toBeInTheDocument();
  });

  it('al hacer dismiss llama a dismissDataIssue (admin only)', async () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockIsAdmin = true;
    mockSnapshot = {
      data: makeSnapshot({
        topIssues: [
          {
            id: 'workers.missing_role',
            domain: 'workers',
            collection: 'workers',
            severity: 'high',
            count: 12,
            description: 'Workers sin cargo asignado: 12.',
            dismissed: false,
          },
        ],
      }),
      loading: false,
      error: null,
      refetch: refetchMock,
    };
    render(<DataConfidence />);
    expect(
      screen.getByTestId('data-confidence-issue-workers.missing_role'),
    ).toBeInTheDocument();
    const dismissBtn = screen.getByTestId(
      'data-confidence-dismiss-workers.missing_role',
    );
    fireEvent.click(dismissBtn);
    await waitFor(() => {
      expect(dismissMock).toHaveBeenCalledWith(
        'p-1',
        'workers.missing_role',
      );
    });
    // After dismissal the issue is removed locally.
    await waitFor(() => {
      expect(
        screen.queryByTestId('data-confidence-issue-workers.missing_role'),
      ).not.toBeInTheDocument();
    });
  });
});

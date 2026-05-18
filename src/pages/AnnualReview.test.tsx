// @vitest-environment jsdom
//
// Praeventio Guard — Sprint K §291-295 page wrapper tests.
//
// Smoke tests for `<AnnualReview />`:
//   1. Empty state when no project is selected.
//   2. Loading state from the hook.
//   3. Error state from the hook.
//   4. Render with objectives + progress bar + section headers.
//   5. Attach-evidence flow calls the mutation.
//   6. Conclude flow calls the mutation and locks the year.
//
// The component mocks all Sprint K bindings (hook + 3 mutations), the
// project context, the firebase auth user and the online status so the
// test is hermetic — no Firestore, no fetch, no network. The shape of
// the mocked data mirrors the server's `AnnualReviewSnapshot`.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AnnualReview } from './AnnualReview';
import type { AnnualReviewSnapshot } from '../hooks/useAnnualReview';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string) => {
      if (typeof fallback === 'string') return fallback;
      return _k;
    },
  }),
}));

let mockSelectedProject: { id: string; name: string } | null = null;
let mockIsOnline = true;
let mockUser: { uid: string; email: string | null; displayName: string | null } | null = null;
type Resp = {
  data: { year: number; exists: boolean; snapshot: AnnualReviewSnapshot | null } | null;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
};
let mockResp: Resp;

const setObjectivesMock = vi.fn();
const attachEvidenceMock = vi.fn();
const concludeMock = vi.fn();
const refetchMock = vi.fn();

vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => ({ selectedProject: mockSelectedProject }),
}));
vi.mock('../contexts/FirebaseContext', () => ({
  useFirebase: () => ({ user: mockUser }),
}));
vi.mock('../hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => mockIsOnline,
}));
vi.mock('../hooks/useAnnualReview', () => ({
  useCurrentAnnualReview: () => mockResp,
  setAnnualReviewObjectives: (...args: unknown[]) => setObjectivesMock(...args),
  attachAnnualReviewEvidence: (...args: unknown[]) =>
    attachEvidenceMock(...args),
  concludeAnnualReview: (...args: unknown[]) => concludeMock(...args),
}));

function makeSnapshot(overrides: Partial<AnnualReviewSnapshot> = {}): AnnualReviewSnapshot {
  return {
    fiscalYear: 2026,
    tenantId: 't-1',
    projectId: 'p-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    updatedByUid: 'u-1',
    objectives: [],
    evidences: [],
    analysis: '',
    conclusion: null,
    signedOffByUid: null,
    signedOffByName: null,
    concludedAt: null,
    isConcluded: false,
    ...overrides,
  };
}

beforeEach(() => {
  mockSelectedProject = null;
  mockIsOnline = true;
  mockUser = { uid: 'u-1', email: 'u@example.com', displayName: 'Usuario Test' };
  mockResp = {
    data: { year: 2026, exists: false, snapshot: null },
    loading: false,
    error: null,
    refetch: refetchMock,
  };
  setObjectivesMock.mockReset();
  attachEvidenceMock.mockReset();
  concludeMock.mockReset();
  refetchMock.mockReset();
  setObjectivesMock.mockResolvedValue(makeSnapshot());
  attachEvidenceMock.mockResolvedValue(makeSnapshot());
  concludeMock.mockResolvedValue(makeSnapshot({ isConcluded: true }));
});

describe('<AnnualReview /> page wrapper (Sprint K §291-295)', () => {
  it('renderiza el empty-state cuando no hay proyecto seleccionado', () => {
    mockSelectedProject = null;
    render(<AnnualReview />);
    expect(screen.getByTestId('annual-review-page-empty')).toBeInTheDocument();
    expect(screen.getByText(/selecciona un proyecto/i)).toBeInTheDocument();
  });

  it('renderiza loading mientras el hook trae datos', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockResp = {
      data: null,
      loading: true,
      error: null,
      refetch: refetchMock,
    };
    render(<AnnualReview />);
    expect(screen.getByTestId('annual-review-loading')).toBeInTheDocument();
  });

  it('renderiza error con el mensaje del hook', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockResp = {
      data: null,
      loading: false,
      error: new Error('Network down'),
      refetch: refetchMock,
    };
    render(<AnnualReview />);
    expect(screen.getByTestId('annual-review-error')).toBeInTheDocument();
    expect(screen.getByText(/Network down/i)).toBeInTheDocument();
  });

  it('renderiza objetivos con progress bar y secciones', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    const snapshot = makeSnapshot({
      objectives: [
        {
          id: 'obj-1',
          fiscalYear: 2026,
          title: 'Reducir incidentes leves',
          description: '',
          metric: 'count_reduction',
          baseline: 10,
          target: 5,
          currentValue: 7,
          deadline: '2026-12-31',
          ownerUid: 'u-1',
          status: 'in_progress',
          linkedActionIds: [],
          evidenceUrls: [],
        },
      ],
    });
    mockResp = {
      data: { year: 2026, exists: true, snapshot },
      loading: false,
      error: null,
      refetch: refetchMock,
    };
    render(<AnnualReview />);
    expect(screen.getByTestId('annual-review-page')).toBeInTheDocument();
    expect(screen.getByTestId('annual-review-section-objectives')).toBeInTheDocument();
    expect(screen.getByTestId('annual-review-section-evidence')).toBeInTheDocument();
    expect(screen.getByTestId('annual-review-section-analysis')).toBeInTheDocument();
    expect(screen.getByTestId('annual-review-section-conclusion')).toBeInTheDocument();
    expect(screen.getByTestId('annual-review-objective-obj-1')).toBeInTheDocument();
    // Title appears in the objective card AND in the evidence-selector
    // dropdown option, so use getAllByText.
    expect(screen.getAllByText('Reducir incidentes leves').length).toBeGreaterThan(0);
    // Progress bar present (computeObjectiveProgress returns a number).
    const bars = screen.getAllByTestId('annual-review-progress-bar');
    expect(bars.length).toBeGreaterThan(0);
  });

  it('adjunta evidencia llamando la mutación con los campos correctos', async () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    const snapshot = makeSnapshot({
      objectives: [
        {
          id: 'obj-1',
          fiscalYear: 2026,
          title: 'Objetivo demo',
          description: '',
          metric: 'percent_completion',
          baseline: 0,
          target: 100,
          currentValue: 30,
          deadline: '2026-12-31',
          ownerUid: 'u-1',
          status: 'in_progress',
          linkedActionIds: [],
          evidenceUrls: [],
        },
      ],
    });
    mockResp = {
      data: { year: 2026, exists: true, snapshot },
      loading: false,
      error: null,
      refetch: refetchMock,
    };
    render(<AnnualReview />);
    const sel = screen.getByTestId(
      'annual-review-evidence-objective-select',
    ) as HTMLSelectElement;
    fireEvent.change(sel, { target: { value: 'obj-1' } });
    const urlInput = screen.getByTestId(
      'annual-review-evidence-url-input',
    ) as HTMLInputElement;
    fireEvent.change(urlInput, { target: { value: '/documents/audit-2026.pdf' } });
    fireEvent.click(screen.getByTestId('annual-review-attach-evidence-btn'));
    await waitFor(() => expect(attachEvidenceMock).toHaveBeenCalledTimes(1));
    expect(attachEvidenceMock).toHaveBeenCalledWith(
      'p-1',
      expect.objectContaining({
        objectiveId: 'obj-1',
        evidenceUrl: '/documents/audit-2026.pdf',
      }),
    );
  });

  it('concluye la revisión y bloquea el año tras escribir conclusión válida', async () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    const snapshot = makeSnapshot();
    mockResp = {
      data: { year: 2026, exists: true, snapshot },
      loading: false,
      error: null,
      refetch: refetchMock,
    };
    render(<AnnualReview />);
    const textarea = screen.getByTestId(
      'annual-review-conclusion-textarea',
    ) as HTMLTextAreaElement;
    fireEvent.change(textarea, {
      target: { value: 'Año cerrado con cumplimiento parcial; foco 2027 en altura.' },
    });
    const btn = screen.getByTestId('annual-review-conclude-btn') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    await waitFor(() => expect(concludeMock).toHaveBeenCalledTimes(1));
    expect(concludeMock).toHaveBeenCalledWith(
      'p-1',
      expect.objectContaining({
        conclusion: 'Año cerrado con cumplimiento parcial; foco 2027 en altura.',
        signedOffByUid: 'u-1',
        signedOffByName: 'Usuario Test',
      }),
    );
  });
});

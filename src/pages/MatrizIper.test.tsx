// @vitest-environment jsdom
//
// Praeventio Guard — page-test for <MatrizIper />.
//
// Asserts the project risk-landscape section that mounts RiskMatrix5x5 over the
// REAL `useIperMatrix` hook (GET /api/sprint-k/:projectId/iper-assessments/
// matrix):
//   1. no-project state when no project is selected.
//   2. loading state while the hook fetches.
//   3. error state surfaces a Spanish-CL message.
//   4. honest empty-state when the project has zero saved assessments.
//   5. renders RiskMatrix5x5 with the real nodes when assessments exist.
//
// And the B.4 "Guardar evaluación" flow (button → recordIperAssessment, which
// persists iper_assessments/{id} AND writes the audit row internally):
//   6. button disabled until a hazard description is typed.
//   7. no-project hint + button stays disabled.
//   8. persists the card values (payload shape of the IPERCAnalysis peer),
//      then refetches the landscape and shows success.
//   9. values reported by the card's onChange are what gets saved.
//  10. persistence failure surfaces an error, no refetch, page survives.
//
// Hermetic: mocks react-i18next, useProject, useFirebase, useIperMatrix,
// recordIperAssessment, IperMatrixCard (props captured — the card's own
// behavior is covered by IperMatrixCard.test.tsx), and the lazy matrix
// wrapper (recharts needs no ResizeObserver this way). No fetch, no Firestore.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MatrizIper } from './MatrizIper';
import type { RiskMatrixNode } from '../components/riskMatrix/RiskMatrix5x5';
import { calculateIper, type IperInput, type IperResult } from '../services/protocols/iper';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string) => (typeof fallback === 'string' ? fallback : _k),
  }),
}));

let mockSelectedProject: { id: string; name: string } | null = null;
vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => ({ selectedProject: mockSelectedProject }),
}));

let mockUser: { uid: string; email?: string | null } | null = null;
vi.mock('../contexts/FirebaseContext', () => ({
  useFirebase: () => ({ user: mockUser }),
}));

vi.mock('../utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const recordMock = vi.fn<(p: unknown) => Promise<{ id: string }>>();
vi.mock('../services/safety/iperAssessments', () => ({
  recordIperAssessment: (p: unknown) => recordMock(p),
}));

// The self-assessment card has its own deps; stub it — this page-test targets
// the page wiring. Props are captured so tests can drive `onChange` exactly
// like the real card does (the card itself is covered by its own test file).
const cardPropsSpy = vi.fn();
vi.mock('../components/protocols/IperMatrixCard', () => ({
  IperMatrixCard: (props: Record<string, unknown>) => {
    cardPropsSpy(props);
    return <div data-testid="iper-matrix-card-stub" />;
  },
}));

// Capture the nodes handed to the matrix; avoids loading recharts in jsdom.
const mockMatrixSpy = vi.fn();
vi.mock('../components/riskMatrix/RiskMatrix5x5Lazy', () => ({
  RiskMatrix5x5Lazy: (props: { nodes: RiskMatrixNode[] }) => {
    mockMatrixSpy(props.nodes);
    return <div data-testid="risk-matrix-rendered">{props.nodes.length} nodos</div>;
  },
}));

let mockHook: {
  nodes: RiskMatrixNode[];
  loading: boolean;
  error: Error | null;
  refetch: () => void;
};
vi.mock('../hooks/useSafetyMetrics', () => ({
  useIperMatrix: () => mockHook,
}));

beforeEach(() => {
  mockSelectedProject = null;
  mockUser = { uid: 'u1', email: 'u1@test.com' };
  mockHook = { nodes: [], loading: false, error: null, refetch: vi.fn() };
  mockMatrixSpy.mockClear();
  cardPropsSpy.mockClear();
  recordMock.mockReset();
  recordMock.mockResolvedValue({ id: 'iper-1' });
});

describe('<MatrizIper /> risk landscape', () => {
  it('no-project state when no project is selected', () => {
    mockSelectedProject = null;
    render(<MatrizIper />);
    expect(screen.getByTestId('iper-landscape.no-project')).toBeInTheDocument();
    expect(screen.queryByTestId('risk-matrix-rendered')).not.toBeInTheDocument();
  });

  it('loading state while the hook fetches', () => {
    mockSelectedProject = { id: 'p1', name: 'Faena Norte' };
    mockHook = { nodes: [], loading: true, error: null, refetch: vi.fn() };
    render(<MatrizIper />);
    expect(screen.getByTestId('iper-landscape.loading')).toBeInTheDocument();
  });

  it('error state surfaces a message', () => {
    mockSelectedProject = { id: 'p1', name: 'Faena Norte' };
    mockHook = { nodes: [], loading: false, error: new Error('boom'), refetch: vi.fn() };
    render(<MatrizIper />);
    expect(screen.getByTestId('iper-landscape.error')).toBeInTheDocument();
  });

  it('honest empty-state when the project has no saved assessments', () => {
    mockSelectedProject = { id: 'p1', name: 'Faena Norte' };
    mockHook = { nodes: [], loading: false, error: null, refetch: vi.fn() };
    render(<MatrizIper />);
    expect(screen.getByTestId('iper-landscape.empty')).toBeInTheDocument();
    expect(screen.queryByTestId('risk-matrix-rendered')).not.toBeInTheDocument();
  });

  it('renders RiskMatrix5x5 with the real nodes when assessments exist', () => {
    mockSelectedProject = { id: 'p1', name: 'Faena Norte' };
    const nodes: RiskMatrixNode[] = [
      { id: 'a1', label: 'Caída de altura', probability: 4, impact: 5, kind: 'risk' },
      { id: 'a2', label: 'Atrapamiento', probability: 2, impact: 3, kind: 'risk' },
    ];
    mockHook = { nodes, loading: false, error: null, refetch: vi.fn() };
    render(<MatrizIper />);
    expect(screen.getByTestId('risk-matrix-rendered')).toHaveTextContent('2 nodos');
    expect(mockMatrixSpy).toHaveBeenCalledWith(nodes);
    expect(screen.queryByTestId('iper-landscape.empty')).not.toBeInTheDocument();
  });
});

describe('<MatrizIper /> guardar evaluación (B.4)', () => {
  beforeEach(() => {
    mockSelectedProject = { id: 'p1', name: 'Faena Norte' };
  });

  it('button disabled until a hazard description is typed', () => {
    render(<MatrizIper />);
    const btn = screen.getByTestId('iper-save-button') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.change(screen.getByTestId('iper-save-description'), {
      target: { value: 'Trabajo en altura' },
    });
    expect(btn.disabled).toBe(false);
  });

  it('no-project: hint visible and button stays disabled', () => {
    mockSelectedProject = null;
    render(<MatrizIper />);
    fireEvent.change(screen.getByTestId('iper-save-description'), {
      target: { value: 'Trabajo en altura' },
    });
    expect(screen.getByTestId('iper-save.no-project')).toBeInTheDocument();
    expect((screen.getByTestId('iper-save-button') as HTMLButtonElement).disabled).toBe(true);
  });

  it('persists the card values via recordIperAssessment and refetches the landscape', async () => {
    render(<MatrizIper />);
    fireEvent.change(screen.getByTestId('iper-save-description'), {
      target: { value: '  Trabajo en altura sobre 1,8 m  ' },
    });
    fireEvent.click(screen.getByTestId('iper-save-button'));

    await waitFor(() => expect(recordMock).toHaveBeenCalledTimes(1));
    const payload = recordMock.mock.calls[0][0] as Record<string, unknown>;
    const expected = calculateIper({ probability: 3, severity: 3 });
    expect(payload.description).toBe('Trabajo en altura sobre 1,8 m');
    expect(payload.projectId).toBe('p1');
    expect(payload.authorUid).toBe('u1');
    expect(payload.inputs).toEqual({ probability: 3, severity: 3 });
    expect(payload.level).toBe(expected.level);
    expect(payload.rawScore).toBe(expected.rawScore);
    expect(payload.recommendation).toBe(expected.recommendation);
    expect(payload.suggestedControls).toEqual([]);
    expect(typeof payload.computedAt).toBe('string');
    expect(payload.durationMin as number).toBeGreaterThanOrEqual(1);

    await waitFor(() => expect(mockHook.refetch).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('iper-save-success')).toBeInTheDocument();
  });

  it('saves what the card reports through onChange (P=5 × S=4 → 20)', async () => {
    render(<MatrizIper />);
    const cardProps = cardPropsSpy.mock.calls.at(-1)?.[0] as {
      onChange?: (i: IperInput, r: IperResult) => void;
    };
    const input: IperInput = { probability: 5, severity: 4 };
    act(() => cardProps.onChange?.(input, calculateIper(input)));

    fireEvent.change(screen.getByTestId('iper-save-description'), {
      target: { value: 'Derrumbe de zanja profunda' },
    });
    fireEvent.click(screen.getByTestId('iper-save-button'));

    await waitFor(() => expect(recordMock).toHaveBeenCalledTimes(1));
    const payload = recordMock.mock.calls[0][0] as {
      inputs: Record<string, unknown>;
      rawScore: number;
    };
    expect(payload.inputs).toEqual({ probability: 5, severity: 4 });
    expect(payload.rawScore).toBe(20);
  });

  it('surfaces an error (no success, no refetch) when persistence fails; page survives', async () => {
    recordMock.mockRejectedValueOnce(new Error('firestore down'));
    render(<MatrizIper />);
    fireEvent.change(screen.getByTestId('iper-save-description'), {
      target: { value: 'Peligro X' },
    });
    fireEvent.click(screen.getByTestId('iper-save-button'));

    await waitFor(() => expect(screen.getByTestId('iper-save-error')).toBeInTheDocument());
    expect(screen.queryByTestId('iper-save-success')).not.toBeInTheDocument();
    expect(mockHook.refetch).not.toHaveBeenCalled();
    expect(screen.getByTestId('matriz-iper-page')).toBeInTheDocument();
  });
});

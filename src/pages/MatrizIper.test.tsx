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
// Hermetic: mocks react-i18next, useProject, useIperMatrix, IperMatrixCard, and
// the lazy matrix wrapper (recharts needs no ResizeObserver this way). No fetch.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MatrizIper } from './MatrizIper';
import type { RiskMatrixNode } from '../components/riskMatrix/RiskMatrix5x5';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string) => (typeof fallback === 'string' ? fallback : _k),
  }),
}));

let mockSelectedProject: { id: string; name: string } | null = null;
vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => ({ selectedProject: mockSelectedProject }),
}));

// The self-assessment card has its own deps; stub it — this page-test targets
// the landscape wiring, not the calculator.
vi.mock('../components/protocols/IperMatrixCard', () => ({
  IperMatrixCard: () => <div data-testid="iper-matrix-card-stub" />,
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
  mockHook = { nodes: [], loading: false, error: null, refetch: vi.fn() };
  mockMatrixSpy.mockClear();
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

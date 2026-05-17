// @vitest-environment jsdom
//
// Praeventio Guard — Sprint K §276-277 page wrapper tests.
//
// Smoke tests for `<LeadershipDecisions />`:
//   1. Empty state when no project is selected.
//   2. Loading state from the hook.
//   3. Error state surfaces with message.
//   4. List render: decisión cards visible with kind badge + impact score.
//   5. Filter by supervisor UID updates the hook query.
//   6. Switching to "Ranking" tab renders supervisor ranking.
//   7. Recording a decision calls the mutation.
//
// Hermetic: hooks and contexts are mocked so the test has no fetch,
// no Firestore, no router state to drive. Matches the patterns used by
// `Inbox.test.tsx`, `CorrectiveActions.test.tsx`, `DrillsManager.test.tsx`.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LeadershipDecisions } from './LeadershipDecisions';
import * as sprintKHooks from '../hooks/useSprintK';
import type {
  LeadershipDecisionsResponse,
  LeadershipRankingResponse,
} from '../hooks/useSprintK';
import type {
  SupervisionDecision,
  SupervisorRanking,
} from '../services/leadership/supervisionDecisionTrail';

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

type DecisionsMock = {
  data: LeadershipDecisionsResponse | null;
  loading: boolean;
  error: Error | null;
};
type RankingMock = {
  data: LeadershipRankingResponse | null;
  loading: boolean;
  error: Error | null;
};

let mockSelectedProject: { id: string; name: string } | null = null;
let mockIsOnline = true;
let mockDecisions: DecisionsMock;
let mockRanking: RankingMock;

// Track the most recent call args so we can assert filter behavior.
let lastDecisionsCallArgs: {
  supervisorUid?: string;
  period?: string;
} | null = null;

vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => ({ selectedProject: mockSelectedProject }),
}));
vi.mock('../hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => mockIsOnline,
}));
vi.mock('../hooks/useSprintK', () => ({
  useLeadershipDecisions: (
    _projectId: string | null,
    opts?: { supervisorUid?: string; period?: string },
  ) => {
    lastDecisionsCallArgs = opts ?? {};
    return mockDecisions;
  },
  useLeadershipRanking: () => mockRanking,
  recordLeadershipDecision: vi.fn(),
}));

function emptyDecisions(): DecisionsMock {
  return { data: { decisions: [] }, loading: false, error: null };
}
function emptyRanking(): RankingMock {
  return { data: { ranking: [] }, loading: false, error: null };
}

function decision(over: Partial<SupervisionDecision> & { id: string }): SupervisionDecision {
  return {
    id: over.id,
    supervisorUid: over.supervisorUid ?? 'sup_test_1',
    decidedAt: over.decidedAt ?? '2026-05-15T10:00:00Z',
    kind: over.kind ?? 'stop_task',
    context: over.context ?? 'Cuadrilla A — andamio sin certificación',
    rationale: over.rationale ?? 'Riesgo de caída a desnivel',
    involvedRef: over.involvedRef,
    outcome: over.outcome,
  };
}

function rankingEntry(
  over: Partial<SupervisorRanking> & { supervisorUid: string },
): SupervisorRanking {
  return {
    supervisorUid: over.supervisorUid,
    totalDecisions: over.totalDecisions ?? 3,
    byKind: over.byKind ?? {
      stop_task: 1,
      reject_unsafe: 1,
      escalate_finding: 0,
      change_method: 0,
      change_crew: 0,
      request_resource: 0,
      authorize_work: 1,
      approve_exception: 0,
      reject_exception: 0,
    },
    totalImpactScore: over.totalImpactScore ?? 60,
    positiveOutcomeRate: over.positiveOutcomeRate ?? 80,
  };
}

beforeEach(() => {
  mockSelectedProject = null;
  mockIsOnline = true;
  lastDecisionsCallArgs = null;
  mockDecisions = emptyDecisions();
  mockRanking = emptyRanking();
});

describe('<LeadershipDecisions /> page wrapper (Sprint K §276-277)', () => {
  it('renderiza empty-state cuando no hay proyecto seleccionado', () => {
    mockSelectedProject = null;
    render(<LeadershipDecisions />);
    expect(
      screen.getByTestId('leadership-decisions-page-empty'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/selecciona un proyecto/i),
    ).toBeInTheDocument();
  });

  it('renderiza loading mientras el hook está cargando', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockDecisions = { data: null, loading: true, error: null };
    render(<LeadershipDecisions />);
    expect(
      screen.getByTestId('leadership-decisions-loading'),
    ).toBeInTheDocument();
  });

  it('muestra el mensaje del error del hook', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockDecisions = {
      data: null,
      loading: false,
      error: new Error('Network down'),
    };
    render(<LeadershipDecisions />);
    expect(
      screen.getByTestId('leadership-decisions-error'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Network down/i)).toBeInTheDocument();
  });

  it('renderiza la lista de decisiones con badge de tipo + score', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockDecisions = {
      data: {
        decisions: [
          decision({
            id: 'ld_a',
            kind: 'stop_task',
            context: 'Andamio sin certificación',
          }),
          decision({
            id: 'ld_b',
            kind: 'reject_unsafe',
            context: 'EPP eléctrico ausente',
          }),
        ],
      },
      loading: false,
      error: null,
    };
    render(<LeadershipDecisions />);
    expect(
      screen.getByTestId('leadership-decisions-list'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('leadership-decision-ld_a')).toBeInTheDocument();
    expect(screen.getByTestId('leadership-decision-ld_b')).toBeInTheDocument();
    expect(screen.getByText('Andamio sin certificación')).toBeInTheDocument();
    // Score for stop_task = 25 (baseWeight, no outcome).
    expect(
      screen.getByTestId('leadership-decision-score-ld_a'),
    ).toHaveTextContent('25');
    // Score for reject_unsafe = 30.
    expect(
      screen.getByTestId('leadership-decision-score-ld_b'),
    ).toHaveTextContent('30');
  });

  it('filtra por supervisorUid cuando el usuario escribe en el input', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockDecisions = emptyDecisions();
    render(<LeadershipDecisions />);
    const input = screen.getByTestId(
      'leadership-decisions-supervisor-input',
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'uid_juan' } });
    // Re-render triggered by state change; check the most recent hook
    // call carried the new filter.
    expect(lastDecisionsCallArgs?.supervisorUid).toBe('uid_juan');
  });

  it('cambia a la pestaña Ranking y muestra supervisores ordenados por impacto', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockDecisions = emptyDecisions();
    mockRanking = {
      data: {
        ranking: [
          rankingEntry({
            supervisorUid: 'sup_top',
            totalImpactScore: 90,
            totalDecisions: 5,
            positiveOutcomeRate: 80,
          }),
          rankingEntry({
            supervisorUid: 'sup_mid',
            totalImpactScore: 35,
            totalDecisions: 2,
            positiveOutcomeRate: 50,
          }),
        ],
      },
      loading: false,
      error: null,
    };
    render(<LeadershipDecisions />);
    fireEvent.click(screen.getByTestId('leadership-decisions-tab-ranking'));
    expect(
      screen.getByTestId('leadership-ranking-list'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('leadership-ranking-sup_top'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('leadership-ranking-score-sup_top'),
    ).toHaveTextContent('90');
    // Trend chip shown for sup_top because positiveOutcomeRate >= 70.
    expect(
      screen.getByTestId('leadership-ranking-trend-sup_top'),
    ).toBeInTheDocument();
  });

  it('al registrar una decisión llama a recordLeadershipDecision y cierra el modal', async () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockDecisions = emptyDecisions();
    const recordMock = vi.mocked(sprintKHooks.recordLeadershipDecision);
    recordMock.mockResolvedValueOnce(
      decision({ id: 'ld_new', kind: 'stop_task' }),
    );

    render(<LeadershipDecisions />);
    fireEvent.click(screen.getByTestId('leadership-decisions-new-button'));
    expect(
      screen.getByTestId('leadership-decisions-modal'),
    ).toBeInTheDocument();

    const ctx = screen.getByTestId(
      'leadership-decisions-modal-context',
    ) as HTMLTextAreaElement;
    fireEvent.change(ctx, {
      target: { value: 'Andamio sin certificación en zona ZA-12' },
    });
    const rat = screen.getByTestId(
      'leadership-decisions-modal-rationale',
    ) as HTMLTextAreaElement;
    fireEvent.change(rat, {
      target: { value: 'Riesgo de caída — se suspende hasta inspección' },
    });

    fireEvent.click(screen.getByTestId('leadership-decisions-modal-submit'));

    await waitFor(() => {
      expect(recordMock).toHaveBeenCalledWith(
        'p-1',
        expect.objectContaining({
          kind: 'stop_task',
          context: 'Andamio sin certificación en zona ZA-12',
          rationale: 'Riesgo de caída — se suspende hasta inspección',
        }),
      );
    });
    // Modal should be closed after the mutation resolves.
    await waitFor(() => {
      expect(
        screen.queryByTestId('leadership-decisions-modal'),
      ).not.toBeInTheDocument();
    });
  });
});

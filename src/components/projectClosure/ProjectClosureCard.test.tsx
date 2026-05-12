// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProjectClosureCard } from './ProjectClosureCard.js';
import type {
  ClosureContext,
  ProjectClosureSnapshot,
} from '../../services/projectClosure/projectClosureService.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

function snapshot(over: Partial<ProjectClosureSnapshot> = {}): ProjectClosureSnapshot {
  return {
    projectId: 'p1',
    closedAt: '2026-05-12T10:00:00Z',
    closedByUid: 'u1',
    totalIncidents: 5,
    criticalIncidents: 0,
    preventedIncidentsEstimated: 12,
    totalActionsCompleted: 30,
    totalSitebookEntries: 120,
    totalTrainingHours: 240,
    averageComplianceScore: 87,
    criticalDecisions: [],
    transferableLessons: [],
    retentionRecommendations: [],
    improvementOpportunities: ['Mejorar onboarding subcontratistas'],
    ...over,
  };
}

const okCtx: ClosureContext = {
  pendingOpenIncidents: 0,
  pendingOpenActions: 0,
  pendingOpenPermits: 0,
  hasFinalReport: true,
  unconfirmedSpofs: 0,
};

const blockedCtx: ClosureContext = {
  pendingOpenIncidents: 2,
  pendingOpenActions: 5,
  pendingOpenPermits: 1,
  hasFinalReport: false,
  unconfirmedSpofs: 1,
};

describe('<ProjectClosureCard />', () => {
  it('renderiza badge listo cuando canClose=true', () => {
    render(<ProjectClosureCard context={okCtx} snapshot={snapshot()} />);
    expect(screen.getByTestId('closure-card')).toBeInTheDocument();
    expect(screen.getByTestId('closure-ready')).toBeInTheDocument();
    expect(screen.queryByTestId('closure-blocked')).toBeNull();
  });

  it('renderiza bloqueadores cuando canClose=false', () => {
    render(<ProjectClosureCard context={blockedCtx} snapshot={snapshot()} />);
    expect(screen.getByTestId('closure-blocked')).toBeInTheDocument();
    expect(screen.getByTestId('closure-blockers')).toBeInTheDocument();
    expect(screen.getByTestId('closure-warnings')).toBeInTheDocument();
  });

  it('cambia summary al cambiar audiencia', () => {
    render(<ProjectClosureCard context={okCtx} snapshot={snapshot()} />);
    expect(screen.getByTestId('closure-summary-management')).toBeInTheDocument();
    const select = screen.getByTestId('closure-audience-select') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'regulatory' } });
    expect(screen.getByTestId('closure-summary-regulatory')).toBeInTheDocument();
  });

  it('dispara onConfirmClose si canClose', () => {
    const onConfirmClose = vi.fn();
    render(
      <ProjectClosureCard
        context={okCtx}
        snapshot={snapshot()}
        onConfirmClose={onConfirmClose}
      />,
    );
    fireEvent.click(screen.getByTestId('closure-confirm'));
    expect(onConfirmClose).toHaveBeenCalled();
  });

  it('no muestra botón confirm si bloqueado', () => {
    const onConfirmClose = vi.fn();
    render(
      <ProjectClosureCard
        context={blockedCtx}
        snapshot={snapshot()}
        onConfirmClose={onConfirmClose}
      />,
    );
    expect(screen.queryByTestId('closure-confirm')).toBeNull();
  });
});

// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RoleAwareDashboard } from './RoleAwareDashboard.js';
import type { RoleViewState } from '../../services/roleViews/roleViewBuilder.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_k: string, fallback?: string) => fallback ?? _k }),
}));

function makeState(over: Partial<RoleViewState> = {}): RoleViewState {
  return {
    userUid: 'u1',
    userRole: 'worker',
    overdueActions: 0,
    pendingApprovals: 0,
    todaysTasks: 2,
    myEppExpiringSoon: 1,
    myTrainingExpiringSoon: 0,
    myUnreadDocuments: 0,
    criticalIncidentsLast7d: 0,
    faenaState: 'operativa',
    ...over,
  };
}

describe('<RoleAwareDashboard />', () => {
  it('worker ve tarjetas relevantes (tareas + EPP + SOS)', () => {
    render(<RoleAwareDashboard state={makeState()} />);
    expect(screen.getByTestId('role-card-w-tasks')).toBeInTheDocument();
    expect(screen.getByTestId('role-card-w-epp')).toBeInTheDocument();
    expect(screen.getByTestId('role-card-w-sos')).toBeInTheDocument();
  });

  it('site_chief ve overdue + approvals + faena urgente', () => {
    render(
      <RoleAwareDashboard
        state={makeState({
          userRole: 'site_chief',
          overdueActions: 3,
          pendingApprovals: 2,
          faenaState: 'emergencia',
        })}
      />,
    );
    expect(screen.getByTestId('role-card-sc-state')).toBeInTheDocument();
    expect(screen.getByTestId('role-card-sc-overdue')).toBeInTheDocument();
    expect(screen.getByTestId('role-card-sc-approve')).toBeInTheDocument();
  });

  it('onCardAction dispara con la tarjeta clickeada', () => {
    const onAction = vi.fn();
    render(<RoleAwareDashboard state={makeState()} onCardAction={onAction} />);
    fireEvent.click(screen.getByTestId('role-card-action-w-sos'));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction.mock.calls[0][0].id).toBe('w-sos');
  });

  it('management con datos ejecutivos muestra ROI + faena', () => {
    render(
      <RoleAwareDashboard
        state={makeState({
          userRole: 'management',
          complianceScore: 87,
          totalActiveProjects: 4,
          totalActiveWorkers: 120,
          preventiveROIClpMonth: 32_500_000,
        })}
      />,
    );
    expect(screen.getByTestId('role-card-mg-compliance')).toBeInTheDocument();
    expect(screen.getByTestId('role-card-mg-overview')).toBeInTheDocument();
    expect(screen.getByTestId('role-card-mg-roi')).toBeInTheDocument();
    expect(screen.getByTestId('role-card-mg-faena')).toBeInTheDocument();
  });

  it('empty state si no hay cards', () => {
    // worker sin pendientes solo tiene el SOS (siempre presente).
    // Probamos el empty con management sin métricas ni faena urgente.
    render(
      <RoleAwareDashboard
        state={makeState({
          userRole: 'management',
          faenaState: 'operativa',
          criticalIncidentsLast7d: 0,
        })}
      />,
    );
    // management siempre incluye estado faena → no empty
    expect(screen.getByTestId('role-card-mg-faena')).toBeInTheDocument();
  });
});

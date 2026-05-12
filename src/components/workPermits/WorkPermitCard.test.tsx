// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WorkPermitCard } from './WorkPermitCard.js';
import type { WorkPermit } from '../../services/workPermits/workPermitEngine.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

const NOW = new Date('2026-05-12T10:00:00Z');

function permit(over: Partial<WorkPermit> = {}): WorkPermit {
  return {
    id: 'p1',
    kind: 'altura',
    workerUid: 'w1',
    approverUid: 'sup1',
    approverRole: 'supervisor',
    taskDescription: 'Reemplazo luminarias techo 6m bodega norte',
    status: 'active',
    preconditions: {
      workerHasTraining: true,
      workerHasEpp: true,
      workerMedicallyFit: true,
      checklist: {
        items: [{ id: 'i1', label: 'Línea de vida instalada', checked: true }],
      },
    },
    createdAt: '2026-05-12T08:00:00Z',
    approvedAt: '2026-05-12T08:30:00Z',
    validFrom: '2026-05-12T09:00:00Z',
    validUntil: '2026-05-12T17:00:00Z',
    ...over,
  };
}

describe('<WorkPermitCard />', () => {
  it('renderiza permiso activo con preconditions OK', () => {
    render(<WorkPermitCard permit={permit()} now={NOW} />);
    expect(screen.getByTestId('permit-card-p1')).toBeInTheDocument();
    expect(screen.getByTestId('permit-status-p1').textContent).toBe('ACTIVE');
    expect(screen.queryByTestId('permit-warning-p1')).toBeNull();
  });

  it('flag warning si faltan preconditions', () => {
    render(
      <WorkPermitCard
        permit={permit({
          preconditions: {
            workerHasTraining: false,
            workerHasEpp: true,
            workerMedicallyFit: true,
            checklist: { items: [{ id: 'i1', label: 'x', checked: false }] },
          },
        })}
        now={NOW}
      />,
    );
    expect(screen.getByTestId('permit-warning-p1')).toBeInTheDocument();
  });

  it('dispara onFulfill', () => {
    const onFul = vi.fn();
    render(<WorkPermitCard permit={permit()} now={NOW} onFulfill={onFul} />);
    fireEvent.click(screen.getByTestId('permit-fulfill-p1'));
    expect(onFul).toHaveBeenCalled();
  });

  it('dispara onCancel', () => {
    const onCan = vi.fn();
    render(<WorkPermitCard permit={permit()} now={NOW} onCancel={onCan} />);
    fireEvent.click(screen.getByTestId('permit-cancel-p1'));
    expect(onCan).toHaveBeenCalled();
  });
});

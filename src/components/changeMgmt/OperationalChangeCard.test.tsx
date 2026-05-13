// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OperationalChangeCard } from './OperationalChangeCard.js';
import type {
  OperationalChange,
  ChangeAcknowledgementSummary,
} from '../../services/changeMgmt/operationalChangeService.js';

const baseChange: OperationalChange = {
  id: 'c1',
  projectId: 'p1',
  kind: 'supervisor',
  whatChanged: 'Cambio de supervisor turno noche',
  previousValue: 'Juan Pérez',
  newValue: 'María López',
  rationale: 'Reasignación operativa',
  impact: 'medium',
  affectedWorkerUids: ['w1', 'w2', 'w3'],
  declaredByUid: 'u1',
  declaredByRole: 'gerente',
  effectiveFrom: '2026-05-12T00:00:00Z',
  declaredAt: '2026-05-11T00:00:00Z',
  acknowledgments: [{ workerUid: 'w1', ackedAt: '2026-05-12T01:00:00Z' }],
};

const baseSummary: ChangeAcknowledgementSummary = {
  changeId: 'c1',
  totalAffected: 3,
  acknowledged: 1,
  pending: 2,
  coveragePercent: 33,
  pendingWorkerUids: ['w2', 'w3'],
};

describe('<OperationalChangeCard />', () => {
  it('renderiza título, impacto y progreso de lectura', () => {
    render(<OperationalChangeCard change={baseChange} summary={baseSummary} />);
    expect(screen.getByTestId('changeMgmt.card.title')).toHaveTextContent(
      'Cambio de supervisor',
    );
    expect(screen.getByTestId('changeMgmt.card.impact')).toHaveTextContent('Medio');
    expect(screen.getByTestId('changeMgmt.card.kind')).toHaveTextContent('supervisor');
    expect(screen.getByTestId('changeMgmt.card.ackProgress').textContent).toContain('1/3');
  });

  it('muestra motivo de reversión cuando aplica', () => {
    render(
      <OperationalChangeCard
        change={{
          ...baseChange,
          revertedAt: '2026-05-13T00:00:00Z',
          revertedReason: 'Error en designación',
        }}
        summary={baseSummary}
      />,
    );
    expect(screen.getByTestId('changeMgmt.card.revertedReason').textContent).toContain(
      'Error en designación',
    );
  });
});

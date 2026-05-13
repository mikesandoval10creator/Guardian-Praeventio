// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LoneWorkerCard } from './LoneWorkerCard.js';
import type { LoneWorkerSession } from '../../services/loneWorker/loneWorkerService.js';

const baseSession: LoneWorkerSession = {
  id: 's1',
  workerUid: 'w42',
  startedAt: '2026-05-12T08:00:00Z',
  checkInIntervalMin: 30,
  checkIns: [{ at: '2026-05-12T08:30:00Z', status: 'ok' }],
  status: 'active',
};

describe('<LoneWorkerCard />', () => {
  it('renderiza título y métricas básicas', () => {
    render(<LoneWorkerCard session={baseSession} status="active" />);
    expect(screen.getByTestId('loneWorker.card.title')).toHaveTextContent('w42');
    expect(screen.getByTestId('loneWorker.card.interval')).toHaveTextContent('30');
    expect(screen.getByTestId('loneWorker.card.checkIns')).toHaveTextContent('1');
    expect(screen.getByTestId('loneWorker.card.status')).toHaveTextContent('Activo');
  });

  it('muestra bloque de escalamiento cuando se pasa', () => {
    render(
      <LoneWorkerCard
        session={baseSession}
        status="overdue_critical"
        escalation={{
          level: 'brigade',
          message: 'Sin contacto >2× intervalo',
          triggeredAt: '2026-05-12T09:30:00Z',
        }}
      />,
    );
    const esc = screen.getByTestId('loneWorker.card.escalation');
    expect(esc).toBeInTheDocument();
    expect(esc.textContent).toContain('brigade');
  });
});

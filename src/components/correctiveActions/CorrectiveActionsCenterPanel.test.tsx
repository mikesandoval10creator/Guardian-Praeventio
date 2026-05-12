// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CorrectiveActionsCenterPanel } from './CorrectiveActionsCenterPanel.js';
import {
  createCorrectiveAction,
  closeAction,
  type CorrectiveActionRecord,
} from '../../services/correctiveActions/correctiveActionsCenter.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

function fixture(): CorrectiveActionRecord[] {
  const a1 = createCorrectiveAction({
    source: 'inspection',
    sourceNodeId: 'insp-1',
    responsibleUid: 'u1',
    dueDate: '2026-06-15T00:00:00.000Z',
    description: 'Instalar barrera física en prensa.',
  });
  const a2 = createCorrectiveAction({
    source: 'incident',
    sourceNodeId: 'inc-2',
    responsibleUid: 'u2',
    dueDate: '2026-05-01T00:00:00.000Z',
    description: 'Investigar fuga de aceite.',
  });
  const a3 = closeAction(
    createCorrectiveAction({
      source: 'audit',
      sourceNodeId: 'aud-3',
      responsibleUid: 'u3',
      dueDate: '2026-04-01T00:00:00.000Z',
      description: 'Cerrar hallazgo de auditoría ISO 45001.',
    }),
    '2026-04-15T00:00:00.000Z',
  );
  return [a1, a2, a3];
}

describe('<CorrectiveActionsCenterPanel />', () => {
  const NOW = new Date('2026-05-12T00:00:00.000Z');

  it('renderiza panel con stats PDCA y filtros', () => {
    render(<CorrectiveActionsCenterPanel actions={fixture()} now={NOW} />);
    expect(screen.getByTestId('corrective-actions-center-panel')).toBeInTheDocument();
    expect(screen.getByTestId('caCenter-pdca-stats')).toBeInTheDocument();
    expect(screen.getByTestId('caCenter-phase-row-plan')).toBeInTheDocument();
    expect(screen.getByTestId('caCenter-phase-row-act')).toBeInTheDocument();
    expect(screen.getByTestId('caCenter-source-filter')).toBeInTheDocument();
    expect(screen.getByTestId('caCenter-status-filter')).toBeInTheDocument();
  });

  it('filtra por source', () => {
    render(<CorrectiveActionsCenterPanel actions={fixture()} now={NOW} />);
    const sourceSel = screen.getByTestId('caCenter-source-filter') as HTMLSelectElement;
    fireEvent.change(sourceSel, { target: { value: 'incident' } });
    const list = screen.getByTestId('caCenter-list');
    expect(list.querySelectorAll('li').length).toBe(1);
    expect(list.textContent).toMatch(/fuga de aceite/i);
  });

  it('filtra por status closed y muestra botón programar review', () => {
    const onSchedule = vi.fn();
    render(
      <CorrectiveActionsCenterPanel
        actions={fixture()}
        now={NOW}
        onScheduleReview={onSchedule}
      />,
    );
    const statusSel = screen.getByTestId('caCenter-status-filter') as HTMLSelectElement;
    fireEvent.change(statusSel, { target: { value: 'closed' } });
    const buttons = screen.getAllByTestId(/^caCenter-schedule-/);
    expect(buttons.length).toBeGreaterThan(0);
    fireEvent.click(buttons[0]);
    expect(onSchedule).toHaveBeenCalledTimes(1);
    expect(onSchedule.mock.calls[0][0].prompt).toMatch(/problema volvió/i);
  });

  it('muestra mensaje vacío si filtros no matchean', () => {
    render(<CorrectiveActionsCenterPanel actions={fixture()} now={NOW} />);
    const sourceSel = screen.getByTestId('caCenter-source-filter') as HTMLSelectElement;
    fireEvent.change(sourceSel, { target: { value: 'training_gap' } });
    expect(screen.getByTestId('caCenter-empty')).toBeInTheDocument();
  });

  it('asigna semáforo rojo a la acción vencida abierta', () => {
    render(<CorrectiveActionsCenterPanel actions={fixture()} now={NOW} />);
    // a2 (incident) vence 2026-05-01 → vencida al 2026-05-12
    const row = screen.getByTestId(/caCenter-row-ca_incident_inc-2_/);
    const dot = row.querySelector('[data-testid^="caCenter-semaforo-"]') as HTMLElement;
    expect(dot.className).toMatch(/bg-rose-500/);
  });
});

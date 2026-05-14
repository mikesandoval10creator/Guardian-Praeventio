// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SlaWatchPanel, type AssessedItem } from './SlaWatchPanel.js';
import type {
  WorkflowItem,
  SlaAssessment,
} from '../../services/escalation/escalationSlaEngine.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

function makeAssessed(
  id: string,
  state: SlaAssessment['state'],
  over: Partial<AssessedItem> = {},
): AssessedItem {
  const item: WorkflowItem = {
    id,
    kind: over.item?.kind ?? 'incident',
    severity: over.item?.severity ?? 'high',
    status: 'open',
    createdAt: '2026-05-13T08:00:00Z',
    ...over.item,
  };
  const fraction =
    state === 'permanently_overdue'
      ? 2.5
      : state === 'breached'
        ? 1.2
        : state === 'near_breach'
          ? 0.85
          : 0.3;
  const assessment: SlaAssessment = {
    state,
    slaMinutes: 60,
    ageMinutes: Math.round(60 * fraction),
    minutesUntilBreach: Math.round(60 * (1 - fraction)),
    consumedFraction: fraction,
    ...over.assessment,
  };
  return { item, assessment, label: over.label ?? `Item ${id}` };
}

describe('<SlaWatchPanel />', () => {
  it('items vacíos: empty state visible', () => {
    render(<SlaWatchPanel items={[]} />);
    expect(screen.getByTestId('sla-watch-empty')).toBeInTheDocument();
  });

  it('renderiza cada item con data-state correcto', () => {
    render(
      <SlaWatchPanel
        items={[
          makeAssessed('i1', 'within_sla'),
          makeAssessed('i2', 'near_breach'),
          makeAssessed('i3', 'breached'),
        ]}
      />,
    );
    expect(screen.getByTestId('sla-watch-item-i1')).toHaveAttribute(
      'data-state',
      'within_sla',
    );
    expect(screen.getByTestId('sla-watch-item-i2')).toHaveAttribute(
      'data-state',
      'near_breach',
    );
    expect(screen.getByTestId('sla-watch-item-i3')).toHaveAttribute(
      'data-state',
      'breached',
    );
  });

  it('sort: más urgente primero (permanently_overdue → within_sla)', () => {
    render(
      <SlaWatchPanel
        items={[
          makeAssessed('i1', 'within_sla'),
          makeAssessed('i2', 'breached'),
          makeAssessed('i3', 'permanently_overdue'),
        ]}
      />,
    );
    const list = screen.getByTestId('sla-watch-items');
    const liEls = list.querySelectorAll('li');
    expect(liEls[0]).toHaveAttribute('data-testid', 'sla-watch-item-i3');
    expect(liEls[1]).toHaveAttribute('data-testid', 'sla-watch-item-i2');
    expect(liEls[2]).toHaveAttribute('data-testid', 'sla-watch-item-i1');
  });

  it('summary muestra counts por state', () => {
    render(
      <SlaWatchPanel
        items={[
          makeAssessed('i1', 'within_sla'),
          makeAssessed('i2', 'within_sla'),
          makeAssessed('i3', 'breached'),
        ]}
      />,
    );
    const summary = screen.getByTestId('sla-watch-summary');
    expect(summary).toHaveTextContent('2 OK');
    expect(summary).toHaveTextContent('1 BRC');
  });

  it('hideHealthy: items en within_sla ocultos', () => {
    render(
      <SlaWatchPanel
        items={[
          makeAssessed('i1', 'within_sla'),
          makeAssessed('i2', 'breached'),
        ]}
        hideHealthy
      />,
    );
    expect(screen.queryByTestId('sla-watch-item-i1')).toBeNull();
    expect(screen.getByTestId('sla-watch-item-i2')).toBeInTheDocument();
  });

  it('hideHealthy + todos healthy: mensaje "Todos dentro del SLA"', () => {
    render(
      <SlaWatchPanel
        items={[
          makeAssessed('i1', 'within_sla'),
          makeAssessed('i2', 'within_sla'),
        ]}
        hideHealthy
      />,
    );
    expect(screen.getByTestId('sla-watch-empty')).toHaveTextContent(
      /Todos los items dentro del SLA/,
    );
  });

  it('onEscalate dispara con el item (solo en items NO within_sla)', () => {
    const onEscalate = vi.fn();
    render(
      <SlaWatchPanel
        items={[
          makeAssessed('i1', 'within_sla'),
          makeAssessed('i2', 'breached'),
        ]}
        onEscalate={onEscalate}
      />,
    );
    // Within SLA NO tiene botón.
    expect(screen.queryByTestId('sla-watch-escalate-i1')).toBeNull();
    // Breached SÍ tiene botón.
    fireEvent.click(screen.getByTestId('sla-watch-escalate-i2'));
    expect(onEscalate).toHaveBeenCalledTimes(1);
    expect(onEscalate.mock.calls[0][0].item.id).toBe('i2');
  });

  it('barra de SLA refleja consumedFraction%', () => {
    const item = makeAssessed('i1', 'near_breach', {
      assessment: {
        state: 'near_breach',
        slaMinutes: 100,
        ageMinutes: 85,
        minutesUntilBreach: 15,
        consumedFraction: 0.85,
      },
    });
    render(<SlaWatchPanel items={[item]} />);
    const bar = screen.getByTestId('sla-watch-item-i1-bar');
    expect(bar.style.width).toBe('85%');
  });

  it('barra capada a 100% aunque consumed > 1', () => {
    const item = makeAssessed('i1', 'permanently_overdue', {
      assessment: {
        state: 'permanently_overdue',
        slaMinutes: 60,
        ageMinutes: 250,
        minutesUntilBreach: -190,
        consumedFraction: 4.17,
      },
    });
    render(<SlaWatchPanel items={[item]} />);
    const bar = screen.getByTestId('sla-watch-item-i1-bar');
    expect(bar.style.width).toBe('100%');
  });

  it('severity SIF se renderiza con tag visible', () => {
    const item = makeAssessed('i1', 'breached', {
      item: {
        id: 'i1',
        kind: 'sos_alert',
        severity: 'sif',
        status: 'open',
        createdAt: '2026-05-13T08:00:00Z',
      },
    });
    render(<SlaWatchPanel items={[item]} />);
    const el = screen.getByTestId('sla-watch-item-i1');
    expect(el).toHaveTextContent(/SIF/);
    expect(el).toHaveTextContent(/SOS/i);
  });

  it('label opcional reemplaza el id como título principal', () => {
    const item = makeAssessed('i1', 'near_breach', {
      label: 'Incidente caída altura — Sector C',
    });
    render(<SlaWatchPanel items={[item]} />);
    expect(screen.getByTestId('sla-watch-item-i1')).toHaveTextContent(
      'Incidente caída altura — Sector C',
    );
  });

  it('currentLevel se muestra cuando está presente', () => {
    const item = makeAssessed('i1', 'breached', {
      item: {
        id: 'i1',
        kind: 'incident',
        severity: 'high',
        status: 'open',
        createdAt: '2026-05-13T08:00:00Z',
        currentLevel: 3,
      },
    });
    render(<SlaWatchPanel items={[item]} />);
    expect(screen.getByTestId('sla-watch-item-i1')).toHaveTextContent(/Lvl 3/);
  });
});

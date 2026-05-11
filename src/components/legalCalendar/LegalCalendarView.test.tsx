// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { LegalCalendarView } from './LegalCalendarView.js';
import type { CalendarEntry } from '../../services/legalCalendar/legalObligationsCalendar.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

function entry(over: Partial<CalendarEntry>): CalendarEntry {
  return {
    id: over.id ?? 'e1',
    kind: over.kind ?? 'cphs_meeting',
    label: over.label ?? 'Reunión CPHS',
    legalCitation: 'DS 54',
    recurrence: 'monthly',
    alertLeadDays: 7,
    nextDueAt: '2026-05-20T00:00:00Z',
    isInAlertWindow: over.isInAlertWindow ?? false,
    daysUntilDue: over.daysUntilDue ?? 30,
    isOverdue: (over.daysUntilDue ?? 30) < 0,
  };
}

describe('<LegalCalendarView />', () => {
  it('agrupa vencidas / próximas / agendadas', () => {
    render(
      <LegalCalendarView
        entries={[
          entry({ id: 'over', daysUntilDue: -5 }),
          entry({ id: 'soon', daysUntilDue: 3, isInAlertWindow: true }),
          entry({ id: 'later', daysUntilDue: 60 }),
        ]}
      />,
    );
    const overdueGroup = screen.getByTestId('legal-calendar-overdue');
    expect(within(overdueGroup).getByTestId('legal-entry-over')).toBeInTheDocument();
    const upcomingGroup = screen.getByTestId('legal-calendar-upcoming');
    expect(within(upcomingGroup).getByTestId('legal-entry-soon')).toBeInTheDocument();
    const scheduledGroup = screen.getByTestId('legal-calendar-scheduled');
    expect(within(scheduledGroup).getByTestId('legal-entry-later')).toBeInTheDocument();
  });

  it('ordena por daysUntilDue ascendente dentro de grupo', () => {
    render(
      <LegalCalendarView
        entries={[
          entry({ id: 'far', daysUntilDue: 100 }),
          entry({ id: 'close', daysUntilDue: 30 }),
          entry({ id: 'mid', daysUntilDue: 60 }),
        ]}
      />,
    );
    const items = within(screen.getByTestId('legal-calendar-scheduled')).getAllByTestId(/^legal-entry-/);
    expect(items[0].getAttribute('data-testid')).toBe('legal-entry-close');
    expect(items[1].getAttribute('data-testid')).toBe('legal-entry-mid');
    expect(items[2].getAttribute('data-testid')).toBe('legal-entry-far');
  });

  it('onEntryClick dispara con la entrada', () => {
    const onClick = vi.fn();
    render(
      <LegalCalendarView
        entries={[entry({ id: 'e1', daysUntilDue: -1 })]}
        onEntryClick={onClick}
      />,
    );
    fireEvent.click(screen.getByTestId('legal-entry-e1'));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClick.mock.calls[0][0].id).toBe('e1');
  });
});

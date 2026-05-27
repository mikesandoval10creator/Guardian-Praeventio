// @vitest-environment jsdom
//
// Praeventio Guard — Plan Bloque 3.14: <LegalObligationCard /> smoke tests.
//
// Anchors the founder directive: the card MUST render the "empresa debe
// firmar y entregar — Praeventio NO envía automáticamente" copy for any
// non-done variant. Auditors grep for this string.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LegalObligationCard } from './LegalObligationCard.js';
import type { CalendarEntry } from '../../services/legalCalendar/legalObligationsCalendar.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

function entry(over: Partial<CalendarEntry>): CalendarEntry {
  return {
    id: over.id ?? 'obl-1',
    kind: over.kind ?? 'medical_exam',
    label: over.label ?? 'Examen ocupacional',
    legalCitation: over.legalCitation ?? 'DS 109 + Ley 16.744',
    recurrence: over.recurrence ?? 'annual',
    alertLeadDays: over.alertLeadDays ?? 30,
    nextDueAt: over.nextDueAt ?? '2026-06-15T00:00:00Z',
    isInAlertWindow: over.isInAlertWindow ?? true,
    daysUntilDue: over.daysUntilDue ?? 25,
    isOverdue: over.isOverdue ?? false,
  };
}

describe('<LegalObligationCard />', () => {
  it('renders the obligation label and legal citation', () => {
    render(<LegalObligationCard entry={entry({})} />);
    expect(screen.getByTestId('legal-obligation-card-obl-1-title')).toHaveTextContent(
      'Examen ocupacional',
    );
    expect(screen.getByText('DS 109 + Ley 16.744')).toBeInTheDocument();
  });

  it('shows the "empresa firma y entrega" directive on upcoming variant', () => {
    render(<LegalObligationCard entry={entry({})} />);
    const banner = screen.getByTestId('legal-obligation-card-obl-1-no-push');
    // Strict prose from the founder directive — auditors grep this.
    expect(banner.textContent).toMatch(/empresa debe firmar y entregar/i);
    expect(banner.textContent).toMatch(/NO env.a autom.ticamente/i);
  });

  it('shows the "empresa firma y entrega" directive on overdue variant', () => {
    render(
      <LegalObligationCard entry={entry({ daysUntilDue: -3, isOverdue: true })} />,
    );
    expect(screen.getByTestId('legal-obligation-card-obl-1-no-push')).toBeInTheDocument();
  });

  it('HIDES the directive on done variant (already entregada)', () => {
    render(<LegalObligationCard entry={entry({})} variant="done" />);
    expect(
      screen.queryByTestId('legal-obligation-card-obl-1-no-push'),
    ).not.toBeInTheDocument();
  });

  it('selects overdue variant automatically from entry flags', () => {
    render(
      <LegalObligationCard entry={entry({ daysUntilDue: -10, isOverdue: true })} />,
    );
    const card = screen.getByTestId('legal-obligation-card-obl-1');
    expect(card.getAttribute('data-variant')).toBe('overdue');
  });

  it('exposes acknowledge + snooze actions when callbacks are provided', () => {
    const onAck = vi.fn();
    const onSnooze = vi.fn();
    render(
      <LegalObligationCard
        entry={entry({})}
        onAcknowledge={onAck}
        onSnooze={onSnooze}
      />,
    );
    fireEvent.click(screen.getByTestId('legal-obligation-card-obl-1-acknowledge'));
    fireEvent.click(screen.getByTestId('legal-obligation-card-obl-1-snooze'));
    expect(onAck).toHaveBeenCalledTimes(1);
    expect(onSnooze).toHaveBeenCalledTimes(1);
  });

  it('hides action buttons on done variant', () => {
    const onAck = vi.fn();
    render(
      <LegalObligationCard entry={entry({})} variant="done" onAcknowledge={onAck} />,
    );
    expect(
      screen.queryByTestId('legal-obligation-card-obl-1-actions'),
    ).not.toBeInTheDocument();
  });
});

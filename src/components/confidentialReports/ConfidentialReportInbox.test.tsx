// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConfidentialReportInbox } from './ConfidentialReportInbox.js';
import type { ConfidentialReport } from '../../services/confidentialReports/confidentialReportsService.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

function report(over: Partial<ConfidentialReport> & { id: string }): ConfidentialReport {
  return {
    id: over.id,
    authorHash: 'h',
    authorIdentified: false,
    kind: over.kind ?? 'harassment_workplace',
    description: 'd',
    involvedUids: ['v1'],
    submittedAt: over.submittedAt ?? '2026-05-11T10:00:00Z',
    status: over.status ?? 'submitted',
  };
}

describe('<ConfidentialReportInbox />', () => {
  it('empty si no hay reportes', () => {
    render(<ConfidentialReportInbox reports={[]} />);
    expect(screen.getByTestId('confidential-inbox-empty')).toBeInTheDocument();
  });

  it('renderiza reportes con SLA badge', () => {
    render(<ConfidentialReportInbox reports={[report({ id: 'r1' })]} />);
    expect(screen.getByTestId('confidential-report-r1')).toBeInTheDocument();
    expect(screen.getByTestId('confidential-sla-r1')).toBeInTheDocument();
  });

  it('flag de represalia visible si está en el set', () => {
    render(
      <ConfidentialReportInbox
        reports={[report({ id: 'r1' })]}
        retaliationReportIds={new Set(['r1'])}
      />,
    );
    expect(screen.getByTestId('confidential-retaliation-r1')).toBeInTheDocument();
  });

  it('ordena breached primero, luego at_risk, luego on_track', () => {
    render(
      <ConfidentialReportInbox
        reports={[
          report({ id: 'fresh', submittedAt: '2026-05-11T09:00:00Z' }),
          report({ id: 'old', submittedAt: '2026-05-01T00:00:00Z', status: 'submitted' }), // breached
        ]}
      />,
    );
    const items = screen.getAllByTestId(/^confidential-report-/);
    expect(items[0].getAttribute('data-testid')).toBe('confidential-report-old');
  });

  it('onReportClick recibe id', () => {
    const onClick = vi.fn();
    render(
      <ConfidentialReportInbox
        reports={[report({ id: 'r1' })]}
        onReportClick={onClick}
      />,
    );
    fireEvent.click(screen.getByTestId('confidential-report-r1').querySelector('button')!);
    expect(onClick).toHaveBeenCalledWith('r1');
  });
});

// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MonthlyClientReportCard } from './MonthlyClientReportCard.js';
import type { MonthlyInputs } from '../../services/clientReporting/monthlyClientReport.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

function inputs(over: Partial<MonthlyInputs> = {}): MonthlyInputs {
  return {
    projectId: 'p1',
    periodLabel: '2026-04',
    totalIncidents: 5,
    criticalIncidents: 0,
    totalActions: 20,
    closedActions: 18,
    trainingHoursCompleted: 200,
    workersActive: 50,
    complianceScore: 85,
    sifPrecursors: 0,
    slaCommitments: [{ name: 'closure_rate', target: 90, achieved: 85 }],
    ...over,
  };
}

describe('<MonthlyClientReportCard />', () => {
  it('renderiza periodLabel y executive summary', () => {
    render(<MonthlyClientReportCard inputs={inputs()} />);
    expect(screen.getByTestId('monthly-report-card').textContent).toMatch(/2026-04/);
    expect(screen.getByTestId('monthly-report-summary')).toBeInTheDocument();
  });

  it('alerts visibles si hay critical incidents', () => {
    render(<MonthlyClientReportCard inputs={inputs({ criticalIncidents: 2 })} />);
    expect(screen.getByTestId('monthly-alerts')).toBeInTheDocument();
  });

  it('SLA compliance visible', () => {
    render(<MonthlyClientReportCard inputs={inputs()} />);
    expect(screen.getByTestId('monthly-sla')).toBeInTheDocument();
    expect(screen.getByTestId('monthly-sla-0')).toBeInTheDocument();
  });

  it('sin alertas reputacionales si todo OK', () => {
    render(<MonthlyClientReportCard inputs={inputs()} />);
    expect(screen.queryByTestId('monthly-alerts')).toBeNull();
  });
});

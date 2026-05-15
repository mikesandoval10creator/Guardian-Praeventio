// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MonthlyClientReportPanel } from './MonthlyClientReportPanel.js';
import type { MonthlyInputs } from '../../services/clientReporting/monthlyClientReport.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

function baseInputs(overrides: Partial<MonthlyInputs> = {}): MonthlyInputs {
  return {
    projectId: 'p-1',
    periodLabel: '2026-04',
    totalIncidents: 5,
    criticalIncidents: 0,
    totalActions: 20,
    closedActions: 18,
    trainingHoursCompleted: 200,
    workersActive: 50,
    complianceScore: 85,
    sifPrecursors: 0,
    slaCommitments: [],
    ...overrides,
  };
}

describe('<MonthlyClientReportPanel />', () => {
  it('renderiza el período', () => {
    render(<MonthlyClientReportPanel inputs={baseInputs()} />);
    expect(screen.getByTestId('monthly-report-period').textContent).toMatch(
      /2026-04/,
    );
  });

  it('renderiza los 4 KPIs', () => {
    render(<MonthlyClientReportPanel inputs={baseInputs()} />);
    expect(screen.getByTestId('monthly-report-kpi-0')).toBeInTheDocument();
    expect(screen.getByTestId('monthly-report-kpi-1')).toBeInTheDocument();
    expect(screen.getByTestId('monthly-report-kpi-2')).toBeInTheDocument();
    expect(screen.getByTestId('monthly-report-kpi-3')).toBeInTheDocument();
  });

  it('renderiza alerta urgente si hubo incidentes críticos', () => {
    render(
      <MonthlyClientReportPanel
        inputs={baseInputs({ criticalIncidents: 2 })}
      />,
    );
    expect(screen.getByTestId('monthly-report-alerts')).toBeInTheDocument();
    expect(screen.getByTestId('monthly-report-alert-0')).toBeInTheDocument();
  });

  it('renderiza SLA con estados', () => {
    render(
      <MonthlyClientReportPanel
        inputs={baseInputs({
          slaCommitments: [
            { name: 'Respuesta <24h', target: 95, achieved: 96 },
            { name: 'Cierre acciones <30d', target: 80, achieved: 60 },
          ],
        })}
      />,
    );
    expect(screen.getByTestId('monthly-report-sla')).toBeInTheDocument();
    expect(screen.getByTestId('monthly-report-sla-0')).toBeInTheDocument();
    expect(screen.getByTestId('monthly-report-sla-1')).toBeInTheDocument();
  });
});

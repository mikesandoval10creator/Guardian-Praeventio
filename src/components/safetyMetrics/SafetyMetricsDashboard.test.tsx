// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SafetyMetricsDashboard } from './SafetyMetricsDashboard.js';
import {
  buildSafetyMetricsReport,
  type IncidentCounts,
} from '../../services/safetyMetrics/osha.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

const counts: IncidentCounts = {
  totalRecordable: 4,
  lostTime: 2,
  restrictedOrTransferred: 1,
  seriousInjuriesAndFatalities: 1,
  fatalities: 0,
  totalLostDays: 15,
};

describe('<SafetyMetricsDashboard />', () => {
  it('renderiza las 6 metric cards', () => {
    render(
      <SafetyMetricsDashboard
        counts={counts}
        exposure={{ totalHoursWorked: 400_000 }}
        periodLabel="2026-Q1"
      />,
    );
    expect(screen.getByTestId('safety-metrics-dashboard')).toBeInTheDocument();
    expect(screen.getByTestId('safety-metric-trir')).toBeInTheDocument();
    expect(screen.getByTestId('safety-metric-ltifr')).toBeInTheDocument();
    expect(screen.getByTestId('safety-metric-dart')).toBeInTheDocument();
    expect(screen.getByTestId('safety-metric-sifr')).toBeInTheDocument();
    expect(screen.getByTestId('safety-metric-severity')).toBeInTheDocument();
    expect(screen.getByTestId('safety-metric-fatality')).toBeInTheDocument();
  });

  it('renderiza periodo y benchmarks TRIR + LTIFR', () => {
    render(
      <SafetyMetricsDashboard
        counts={counts}
        exposure={{ totalHoursWorked: 400_000 }}
        periodLabel="2026-Q1"
        industry="mining_cl"
      />,
    );
    expect(screen.getByTestId('safety-metrics-period').textContent).toBe('2026-Q1');
    expect(screen.getByTestId('safety-metric-benchmark-trir')).toBeInTheDocument();
    expect(screen.getByTestId('safety-metric-benchmark-ltifr')).toBeInTheDocument();
  });

  it('renderiza trend cuando se pasa previous', () => {
    const previous = buildSafetyMetricsReport(
      { ...counts, totalRecordable: 8 },
      { totalHoursWorked: 400_000 },
    );
    render(
      <SafetyMetricsDashboard
        counts={counts}
        exposure={{ totalHoursWorked: 400_000 }}
        previous={previous}
      />,
    );
    expect(screen.getByTestId('safety-metric-trend-trir')).toBeInTheDocument();
  });

  it('warning si hay fatalidades', () => {
    render(
      <SafetyMetricsDashboard
        counts={{ ...counts, fatalities: 1 }}
        exposure={{ totalHoursWorked: 400_000 }}
      />,
    );
    expect(screen.getByTestId('safety-metrics-fatality-warning')).toBeInTheDocument();
  });

  it('sin warning si sin fatalidades', () => {
    render(
      <SafetyMetricsDashboard
        counts={counts}
        exposure={{ totalHoursWorked: 400_000 }}
      />,
    );
    expect(screen.queryByTestId('safety-metrics-fatality-warning')).toBeNull();
  });
});

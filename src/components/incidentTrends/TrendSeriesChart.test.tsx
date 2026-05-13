// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TrendSeriesChart } from './TrendSeriesChart.js';
import type {
  TrendSeries,
  PeriodComparison,
  OutlierPoint,
} from '../../services/incidentTrends/trendAnalyzer.js';

const series: TrendSeries = {
  granularity: 'month',
  points: [
    {
      bucket: '2026-01',
      bucketStartIso: '2026-01-01T00:00:00.000Z',
      count: 2,
      bySeverity: { low: 1, medium: 1, high: 0, critical: 0 },
    },
    {
      bucket: '2026-02',
      bucketStartIso: '2026-02-01T00:00:00.000Z',
      count: 5,
      bySeverity: { low: 2, medium: 2, high: 1, critical: 0 },
    },
  ],
  avgCount: 3.5,
  movingAvg3: [2, 3.5],
  direction: 'rising',
  slope: 1.5,
};

describe('<TrendSeriesChart />', () => {
  it('renderiza barras por bucket', () => {
    render(<TrendSeriesChart series={series} />);
    expect(screen.getByTestId('incidentTrends.chart')).toBeInTheDocument();
    expect(screen.getByTestId('incidentTrends.bars')).toBeInTheDocument();
    expect(screen.getByTestId('incidentTrends.bar.2026-01')).toBeInTheDocument();
    expect(screen.getByTestId('incidentTrends.bar.2026-02')).toBeInTheDocument();
    expect(screen.getByTestId('incidentTrends.directionLabel').textContent).toMatch(/aumento/i);
  });

  it('renderiza comparación y outliers', () => {
    const comparison: PeriodComparison = {
      currentTotal: 5,
      previousTotal: 2,
      deltaPercent: 150,
      direction: 'rising',
    };
    const outliers: OutlierPoint[] = [{ bucket: '2026-02', count: 5, zScore: 3.4 }];
    render(
      <TrendSeriesChart
        series={series}
        comparison={comparison}
        outliers={outliers}
      />,
    );
    expect(screen.getByTestId('incidentTrends.comparison')).toBeInTheDocument();
    expect(screen.getByTestId('incidentTrends.delta').textContent).toMatch(/150/);
    expect(screen.getByTestId('incidentTrends.outliersList')).toBeInTheDocument();
    expect(screen.getByTestId('incidentTrends.outlier.2026-02')).toBeInTheDocument();
  });

  it('muestra empty state con series vacía', () => {
    const empty: TrendSeries = {
      granularity: 'month',
      points: [],
      avgCount: 0,
      movingAvg3: [],
      direction: 'stable',
      slope: 0,
    };
    render(<TrendSeriesChart series={empty} />);
    expect(screen.getByTestId('incidentTrends.empty')).toBeInTheDocument();
  });
});

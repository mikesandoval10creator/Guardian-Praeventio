// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SafetyTrendChart, type SafetyTrendPoint } from './SafetyTrendChart.js';

// Recharts depende de ResizeObserver — mock para jsdom.
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
 
globalThis.ResizeObserver = ResizeObserverMock;

const SAMPLE: SafetyTrendPoint[] = [
  { period: '2026-01', trir: 3.2, ltifr: 1.1, dart: 2.0, sifr: 0.1 },
  { period: '2026-02', trir: 2.9, ltifr: 0.9, dart: 1.8, sifr: 0.0 },
  { period: '2026-03', trir: 2.7, ltifr: 0.8, dart: 1.6, sifr: 0.05 },
];

describe('SafetyTrendChart', () => {
  it('renderiza header, count y footer', () => {
    render(<SafetyTrendChart data={SAMPLE} />);
    expect(screen.getByTestId('safety-trend.title')).toHaveTextContent(/OSHA/i);
    expect(screen.getByTestId('safety-trend.count')).toHaveTextContent('3 períodos');
    expect(screen.getByTestId('safety-trend.footer')).toBeInTheDocument();
  });

  it('lista vacía no rompe', () => {
    render(<SafetyTrendChart data={[]} />);
    expect(screen.getByTestId('safety-trend.count')).toHaveTextContent('0 períodos');
  });

  it('appearance dark cambia className', () => {
    render(<SafetyTrendChart data={SAMPLE} appearance="dark" />);
    const root = screen.getByTestId('safety-trend.chart');
    expect(root.className).toMatch(/bg-slate-800/);
  });

  it('acepta benchmark sin romper', () => {
    render(<SafetyTrendChart data={SAMPLE} industryBenchmark={{ trir: 3.0, ltifr: 1.0 }} />);
    expect(screen.getByTestId('safety-trend.chart')).toBeInTheDocument();
  });

  it('acepta metricsShown selectivo', () => {
    render(
      <SafetyTrendChart data={SAMPLE} metricsShown={{ trir: false, ltifr: true, dart: true, sifr: true }} />,
    );
    expect(screen.getByTestId('safety-trend.chart')).toBeInTheDocument();
  });
});

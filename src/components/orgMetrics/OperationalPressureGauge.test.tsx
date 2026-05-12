// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OperationalPressureGauge } from './OperationalPressureGauge.js';
import type { PressureSignals } from '../../services/orgMetrics/organizationalMetrics.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

function sig(over: Partial<PressureSignals> = {}): PressureSignals {
  return {
    overdueTasks: 0,
    overtimeHoursWeekTotal: 0,
    minorIncidentsLast7d: 0,
    absenteeismRate: 0,
    hasNightShift: false,
    hasAdverseWeather: false,
    totalActiveWorkers: 30,
    ...over,
  };
}

describe('<OperationalPressureGauge />', () => {
  it('renderiza score + level low cuando todo OK', () => {
    render(<OperationalPressureGauge signals={sig()} />);
    expect(screen.getByTestId('operational-pressure-gauge')).toBeInTheDocument();
    expect(screen.getByTestId('operational-pressure-level').textContent).toBe('low');
  });

  it('sube level con muchas overdue tasks', () => {
    render(
      <OperationalPressureGauge
        signals={sig({ overdueTasks: 30, overtimeHoursWeekTotal: 200, minorIncidentsLast7d: 8 })}
      />,
    );
    expect(['high', 'critical']).toContain(
      screen.getByTestId('operational-pressure-level').textContent,
    );
  });

  it('lista top drivers cuando hay', () => {
    render(
      <OperationalPressureGauge
        signals={sig({ overdueTasks: 30, hasNightShift: true, hasAdverseWeather: true })}
      />,
    );
    expect(screen.getByTestId('operational-pressure-drivers')).toBeInTheDocument();
  });
});

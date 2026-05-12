// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ClimatePlanAdjustment } from './ClimatePlanAdjustment.js';
import type {
  ScheduledTask,
  WeatherConditions,
} from '../../services/climateAwareScheduling/climateAwareScheduling.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

function task(over: Partial<ScheduledTask> & { id: string }): ScheduledTask {
  return {
    id: over.id,
    category: over.category ?? 'altura',
    scheduledHour: 10,
    outdoor: true,
    workerUids: ['w1'],
  };
}

const calmDay: WeatherConditions = {
  temperatureC: 22,
  humidityPercent: 50,
  windSpeedMs: 3,
  rainProbability: 0.1,
  uvIndex: 4,
  visibilityKm: 10,
};

describe('<ClimatePlanAdjustment />', () => {
  it('día calmo → counter proceed alto', () => {
    render(<ClimatePlanAdjustment tasks={[task({ id: 't1' })]} weather={calmDay} />);
    expect(screen.getByTestId('climate-counter-proceed').textContent).toMatch(/1/);
  });

  it('viento alto en izaje → suspended', () => {
    render(
      <ClimatePlanAdjustment
        tasks={[task({ id: 't1', category: 'izaje' })]}
        weather={{ ...calmDay, windSpeedMs: 13 }}
      />,
    );
    expect(screen.getByTestId('climate-counter-suspend').textContent).toMatch(/1/);
    expect(screen.getByTestId('climate-task-t1')).toBeInTheDocument();
  });

  it('onTaskClick recibe id', () => {
    const onClick = vi.fn();
    render(
      <ClimatePlanAdjustment
        tasks={[task({ id: 't1', category: 'izaje' })]}
        weather={{ ...calmDay, windSpeedMs: 13 }}
        onTaskClick={onClick}
      />,
    );
    fireEvent.click(screen.getByTestId('climate-task-t1'));
    expect(onClick).toHaveBeenCalledWith('t1');
  });
});

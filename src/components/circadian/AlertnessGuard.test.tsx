// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AlertnessGuard } from './AlertnessGuard.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

describe('<AlertnessGuard />', () => {
  it('high alertness en peak window', () => {
    render(
      <AlertnessGuard
        input={{
          localHour: 10,
          sleepHoursLast24h: 8,
          consecutiveNightShifts: 0,
        }}
      />,
    );
    expect(screen.getByTestId('alertness-guard')).toBeInTheDocument();
    expect(Number(screen.getByTestId('alertness-score').textContent)).toBeGreaterThan(70);
  });

  it('critical → block visible si blockingCriticalOperation', () => {
    render(
      <AlertnessGuard
        input={{
          localHour: 4,
          sleepHoursLast24h: 3,
          consecutiveNightShifts: 6,
        }}
        blockingCriticalOperation={true}
      />,
    );
    expect(screen.getByTestId('alertness-blocked')).toBeInTheDocument();
  });

  it('sin blockingCriticalOperation no muestra block', () => {
    render(
      <AlertnessGuard
        input={{
          localHour: 4,
          sleepHoursLast24h: 3,
          consecutiveNightShifts: 6,
        }}
      />,
    );
    expect(screen.queryByTestId('alertness-blocked')).toBeNull();
  });
});

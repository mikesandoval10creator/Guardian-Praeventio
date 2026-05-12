// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HeatStressCard } from './HeatStressCard.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

describe('<HeatStressCard />', () => {
  it('renderiza WBGT y protocolo normal', () => {
    render(
      <HeatStressCard tempC={22} humidityPercent={50} solarLoad="low" intensity="light" />,
    );
    expect(screen.getByTestId('heat-stress-card')).toBeInTheDocument();
    expect(screen.getByTestId('heat-stress-wbgt')).toBeInTheDocument();
    expect(screen.getByTestId('heat-stress-work').textContent).toMatch(/60/);
  });

  it('flag STOP cuando wbgt extremo + heavy', () => {
    render(
      <HeatStressCard
        tempC={42}
        humidityPercent={85}
        solarLoad="high"
        intensity="very_heavy"
      />,
    );
    expect(screen.getByTestId('heat-stress-stop')).toBeInTheDocument();
  });

  it('renderiza 3 stats work/rest/hydration', () => {
    render(
      <HeatStressCard tempC={30} humidityPercent={60} intensity="moderate" />,
    );
    expect(screen.getByTestId('heat-stress-work')).toBeInTheDocument();
    expect(screen.getByTestId('heat-stress-rest')).toBeInTheDocument();
    expect(screen.getByTestId('heat-stress-hydration')).toBeInTheDocument();
  });
});

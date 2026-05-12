// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SpiDashboard } from './SpiDashboard.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

const perfectLeading = {
  preTaskChecklistCompletion: 1,
  dailyTalksDeliveryRate: 1,
  trainingCurrencyRate: 1,
  plannedInspectionsRate: 1,
  nearMissReportingRate: 15,
  positiveObservationsRate: 15,
};

const perfectLagging = {
  trir: 0,
  ltifr: 0,
  lostDays: 0,
  severityRate: 0,
  regulatoryFindings: 0,
};

describe('<SpiDashboard />', () => {
  it('renderiza SPI score + componentes leading/lagging', () => {
    render(<SpiDashboard leading={perfectLeading} lagging={perfectLagging} />);
    expect(screen.getByTestId('spi-dashboard')).toBeInTheDocument();
    expect(screen.getByTestId('spi-score').textContent).toBe('100');
    expect(screen.getByTestId('spi-leading').textContent).toBe('100');
    expect(screen.getByTestId('spi-lagging').textContent).toBe('100');
  });

  it('muestra critical alert si SPI < 40', () => {
    render(
      <SpiDashboard
        leading={{
          preTaskChecklistCompletion: 0,
          dailyTalksDeliveryRate: 0,
          trainingCurrencyRate: 0,
          plannedInspectionsRate: 0,
          nearMissReportingRate: 0,
          positiveObservationsRate: 0,
        }}
        lagging={{
          trir: 5,
          ltifr: 10,
          lostDays: 100,
          severityRate: 1000,
          regulatoryFindings: 10,
        }}
      />,
    );
    expect(screen.getByTestId('spi-critical-alert')).toBeInTheDocument();
  });

  it('focus areas visible', () => {
    render(<SpiDashboard leading={perfectLeading} lagging={perfectLagging} />);
    expect(screen.getByTestId('spi-focus-areas')).toBeInTheDocument();
  });
});

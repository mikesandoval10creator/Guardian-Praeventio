// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AirQualityPanel } from './AirQualityPanel.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

describe('<AirQualityPanel />', () => {
  it('renderiza ppm y level con steady-state', () => {
    render(
      <AirQualityPanel
        co2Zone={{ volumeM3: 100, airExchangeM3perH: 200 }}
        co2Driver={{ occupancyCount: 10 }}
      />,
    );
    expect(screen.getByTestId('air-quality-panel')).toBeInTheDocument();
    expect(screen.getByTestId('air-quality-ppm')).toBeInTheDocument();
    expect(screen.getByTestId('air-quality-level')).toBeInTheDocument();
  });

  it('declara cuando el CO₂ es una estimación sin sensor conectado', () => {
    render(
      <AirQualityPanel
        co2Zone={{ volumeM3: 100, airExchangeM3perH: 200 }}
        co2Driver={{ occupancyCount: 10 }}
      />,
    );
    expect(screen.getByTestId('air-quality-source')).toHaveTextContent(
      /estimación del modelo.*sin lectura de sensor/i,
    );
  });

  it('declara cuando el CO₂ proviene de una lectura de sensor', () => {
    render(
      <AirQualityPanel
        co2Zone={{ volumeM3: 100, airExchangeM3perH: 200 }}
        co2Driver={{ occupancyCount: 10 }}
        currentPpm={650}
      />,
    );
    expect(screen.getByTestId('air-quality-source')).toHaveTextContent(
      /lectura de sensor/i,
    );
  });

  it('lista acciones cuando level=critical', () => {
    render(
      <AirQualityPanel
        co2Zone={{ volumeM3: 50, airExchangeM3perH: 50 }}
        co2Driver={{ occupancyCount: 30, activityFactor: 2.5 }}
      />,
    );
    expect(screen.getByTestId('air-quality-actions')).toBeInTheDocument();
  });

  it('lectura actual sobreescribe steady-state', () => {
    render(
      <AirQualityPanel
        co2Zone={{ volumeM3: 100, airExchangeM3perH: 200 }}
        co2Driver={{ occupancyCount: 1 }}
        currentPpm={2500}
      />,
    );
    expect(screen.getByTestId('air-quality-level').textContent).toMatch(/Crítica/);
  });

  it('temperatura predicha si se pasa zona térmica', () => {
    render(
      <AirQualityPanel
        co2Zone={{ volumeM3: 100, airExchangeM3perH: 200 }}
        co2Driver={{ occupancyCount: 5 }}
        thermal={{
          zone: { thermalCapacityJperK: 100_000, thermalResistanceKperW: 0.01 },
          driver: { ambientC: 30, internalGainW: 500, hvacW: -1000 },
        }}
      />,
    );
    expect(screen.getByTestId('air-quality-temp')).toBeInTheDocument();
  });
});

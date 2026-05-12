// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MeasurementQualityCard } from './MeasurementQualityCard.js';
import type { ChainValidationResult } from '../../services/measurements/measurementChain.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

describe('<MeasurementQualityCard />', () => {
  it('renderiza score 100 sin mediciones', () => {
    render(<MeasurementQualityCard results={[]} />);
    expect(screen.getByTestId('measurement-quality-card')).toBeInTheDocument();
    expect(screen.getByTestId('measurement-quality-score').textContent).toBe('100');
  });

  it('cuenta valid/invalid/warnings', () => {
    const results: ChainValidationResult[] = [
      { measurementId: 'm1', isValid: true, failures: [], warnings: [] },
      { measurementId: 'm2', isValid: false, failures: ['Instrumento X vencido'], warnings: [] },
      {
        measurementId: 'm3',
        isValid: true,
        failures: [],
        warnings: ['Medición WBGT sin temperatura'],
      },
    ];
    render(<MeasurementQualityCard results={results} />);
    expect(screen.getByTestId('measurement-quality-valid').textContent).toMatch(/2/);
    expect(screen.getByTestId('measurement-quality-invalid').textContent).toMatch(/1/);
    expect(screen.getByTestId('measurement-quality-warnings').textContent).toMatch(/1/);
  });

  it('lista top motivos de rechazo', () => {
    const results: ChainValidationResult[] = [
      {
        measurementId: 'm1',
        isValid: false,
        failures: ['Instrumento abc con calibración vencida'],
        warnings: [],
      },
      {
        measurementId: 'm2',
        isValid: false,
        failures: ['Instrumento xyz con calibración vencida'],
        warnings: [],
      },
    ];
    render(<MeasurementQualityCard results={results} />);
    expect(screen.getByTestId('measurement-quality-failures')).toBeInTheDocument();
    expect(screen.getByTestId('measurement-quality-failure-0')).toBeInTheDocument();
  });
});

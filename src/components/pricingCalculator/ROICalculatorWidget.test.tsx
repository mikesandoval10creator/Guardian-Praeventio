// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ROICalculatorWidget } from './ROICalculatorWidget.js';
import * as pricing from '../../services/pricingCalculator/pricingCalculator.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

describe('<ROICalculatorWidget />', () => {
  it.each(['future-level', 'constructor'])('shows a neutral state for %s without hiding the ratio', (level) => {
    const inputs = {
      costPerPreventedIncident: 0, preventedIncidents: 0, costPerAvoidedFine: 0,
      finesAvoided: 0, adminHoursSaved: 0, adminHourlyRateClp: 0,
      monthlyPlanClp: 100_000, additionalSafetyInvestmentClp: 0,
    };
    const report = pricing.computeROI(inputs);
    const compute = vi.spyOn(pricing, 'computeROI').mockReturnValue({
      ...report, level: level as typeof report.level,
    });
    try {
      render(<ROICalculatorWidget inputs={inputs} />);
      const widget = screen.getByTestId('roi-calculator-widget');
      expect(widget).toHaveClass('border-default-token');
      expect(widget).not.toHaveTextContent(level.toUpperCase());
      expect(screen.getByTestId('roi-ratio')).toHaveTextContent('0x');
    } finally {
      compute.mockRestore();
    }
  });

  it('renderiza level y ratio', () => {
    render(
      <ROICalculatorWidget
        inputs={{
          costPerPreventedIncident: 5_000_000,
          preventedIncidents: 2,
          costPerAvoidedFine: 1_000_000,
          finesAvoided: 1,
          adminHoursSaved: 100,
          adminHourlyRateClp: 10_000,
          monthlyPlanClp: 200_000,
          additionalSafetyInvestmentClp: 500_000,
        }}
      />,
    );
    expect(screen.getByTestId('roi-calculator-widget')).toBeInTheDocument();
    expect(screen.getByTestId('roi-ratio').textContent).toMatch(/x|∞/);
    expect(screen.getByTestId('roi-message')).toBeInTheDocument();
  });

  it('underwater no rompe render', () => {
    render(
      <ROICalculatorWidget
        inputs={{
          costPerPreventedIncident: 1_000_000,
          preventedIncidents: 0,
          costPerAvoidedFine: 500_000,
          finesAvoided: 0,
          adminHoursSaved: 0,
          adminHourlyRateClp: 0,
          monthlyPlanClp: 150_000,
          additionalSafetyInvestmentClp: 0,
        }}
      />,
    );
    expect(screen.getByTestId('roi-calculator-widget')).toHaveTextContent('UNDERWATER');
  });

  it('payback ∞ cuando no hay beneficios', () => {
    render(
      <ROICalculatorWidget
        inputs={{
          costPerPreventedIncident: 0,
          preventedIncidents: 0,
          costPerAvoidedFine: 0,
          finesAvoided: 0,
          adminHoursSaved: 0,
          adminHourlyRateClp: 0,
          monthlyPlanClp: 100_000,
          additionalSafetyInvestmentClp: 0,
        }}
      />,
    );
    expect(screen.getByTestId('roi-payback').textContent).toContain('∞');
  });
});

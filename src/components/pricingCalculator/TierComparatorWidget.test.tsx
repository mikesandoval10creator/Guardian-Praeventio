// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TierComparatorWidget } from './TierComparatorWidget.js';
import type { TierPlan } from '../../services/pricingCalculator/pricingCalculator.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

const basic: TierPlan = {
  id: 'basic',
  monthlyPriceClp: 50_000,
  workerLimit: 20,
  projectLimit: 2,
  overagePerWorkerClp: 1_000,
  overagePerProjectClp: 5_000,
  features: [],
};

const pro: TierPlan = {
  id: 'pro',
  monthlyPriceClp: 150_000,
  workerLimit: 100,
  projectLimit: 10,
  overagePerWorkerClp: 800,
  overagePerProjectClp: 4_000,
  features: [],
};

describe('<TierComparatorWidget />', () => {
  it('renderiza filas para cada plan', () => {
    render(
      <TierComparatorWidget
        plans={[basic, pro]}
        usage={{ activeWorkers: 15, activeProjects: 1 }}
      />,
    );
    expect(screen.getByTestId('tier-row-basic')).toBeInTheDocument();
    expect(screen.getByTestId('tier-row-pro')).toBeInTheDocument();
  });

  it('badge recommended visible en el plan más barato que cubre', () => {
    render(
      <TierComparatorWidget
        plans={[basic, pro]}
        usage={{ activeWorkers: 15, activeProjects: 1 }}
      />,
    );
    expect(screen.getByTestId('tier-recommended-basic')).toBeInTheDocument();
  });

  it('onSelectTier dispara con id', () => {
    const onSelect = vi.fn();
    render(
      <TierComparatorWidget
        plans={[basic]}
        usage={{ activeWorkers: 15, activeProjects: 1 }}
        onSelectTier={onSelect}
      />,
    );
    fireEvent.click(screen.getByTestId('tier-row-basic').querySelector('button')!);
    expect(onSelect).toHaveBeenCalledWith('basic');
  });
});

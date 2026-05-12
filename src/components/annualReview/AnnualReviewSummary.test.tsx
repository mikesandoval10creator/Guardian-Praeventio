// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AnnualReviewSummary } from './AnnualReviewSummary.js';
import type { PreventiveObjective } from '../../services/annualReview/annualSgiReview.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

function obj(over: Partial<PreventiveObjective> & { id: string }): PreventiveObjective {
  return {
    id: over.id,
    fiscalYear: 2026,
    title: over.title ?? 'obj',
    description: '',
    metric: 'percent_reduction',
    baseline: 100,
    target: 70,
    currentValue: over.currentValue ?? 85,
    deadline: '2026-12-31T23:59:59Z',
    ownerUid: 'o',
    status: 'in_progress',
    linkedActionIds: [],
    evidenceUrls: [],
  };
}

describe('<AnnualReviewSummary />', () => {
  it('counters por status', () => {
    render(
      <AnnualReviewSummary
        objectives={[
          obj({ id: 'achieved', currentValue: 70 }),
          obj({ id: 'inflight' }),
        ]}
        fiscalYear={2026}
      />,
    );
    expect(screen.getByTestId('annual-counter-achieved').textContent).toMatch(/^1/);
  });

  it('achievement rate visible', () => {
    render(
      <AnnualReviewSummary
        objectives={[obj({ id: 'a', currentValue: 70 })]}
        fiscalYear={2026}
      />,
    );
    expect(screen.getByTestId('annual-achievement-rate').textContent).toMatch(/100/);
  });

  it('top performers visibles cuando hay achieved', () => {
    render(
      <AnnualReviewSummary
        objectives={[obj({ id: 'a', currentValue: 70 })]}
        fiscalYear={2026}
      />,
    );
    expect(screen.getByTestId('annual-top-performers')).toBeInTheDocument();
    expect(screen.getByTestId('annual-top-a')).toBeInTheDocument();
  });
});

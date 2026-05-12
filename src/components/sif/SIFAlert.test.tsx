// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SIFAlert, type SIFAlertItem } from './SIFAlert.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

function item(over: Partial<SIFAlertItem> & { id: string }): SIFAlertItem {
  return {
    id: over.id,
    kind: over.kind ?? 'altura_sin_lesion',
    potential: over.potential ?? 'fatal',
    rationale: ['Caída desde 5m'],
    executiveReviewRequired: over.executiveReviewRequired ?? true,
    mandanteNotificationRequired: over.mandanteNotificationRequired ?? true,
    occurredAt: over.occurredAt ?? '2026-05-11T10:00:00Z',
    reviewedAt: over.reviewedAt,
    notifiedMandanteAt: over.notifiedMandanteAt,
  };
}

describe('<SIFAlert />', () => {
  it('empty state', () => {
    render(<SIFAlert precursors={[]} />);
    expect(screen.getByTestId('sif-alert-empty')).toBeInTheDocument();
  });

  it('muestra item con potencial fatal', () => {
    render(<SIFAlert precursors={[item({ id: 'p1' })]} />);
    expect(screen.getByTestId('sif-item-p1')).toBeInTheDocument();
    expect(screen.getByTestId('sif-item-p1')).toHaveTextContent(/fatal/i);
  });

  it('onReview dispara solo si pendiente', () => {
    const onReview = vi.fn();
    render(<SIFAlert precursors={[item({ id: 'p1' })]} onReview={onReview} />);
    fireEvent.click(screen.getByTestId('sif-review-p1'));
    expect(onReview).toHaveBeenCalledTimes(1);
  });

  it('si ya revisado NO muestra botón review', () => {
    render(
      <SIFAlert
        precursors={[item({ id: 'p1', reviewedAt: '2026-05-12T10:00:00Z' })]}
      />,
    );
    expect(screen.queryByTestId('sif-review-p1')).toBeNull();
  });

  it('onNotifyMandante solo si pendiente', () => {
    const onNotify = vi.fn();
    render(<SIFAlert precursors={[item({ id: 'p1' })]} onNotifyMandante={onNotify} />);
    fireEvent.click(screen.getByTestId('sif-notify-p1'));
    expect(onNotify).toHaveBeenCalledTimes(1);
  });

  it('badge muestra count', () => {
    render(
      <SIFAlert
        precursors={[
          item({ id: 'a' }),
          item({ id: 'b' }),
          item({ id: 'c' }),
        ]}
      />,
    );
    expect(screen.getByTestId('sif-alert')).toHaveTextContent('3');
  });
});

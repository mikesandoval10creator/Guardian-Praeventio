// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SpacedRepetitionReviewQueue } from './SpacedRepetitionReviewQueue.js';
import { createInitialCard } from '../../services/spacedRepetition/spacedRepetitionScheduler.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

describe('<SpacedRepetitionReviewQueue />', () => {
  it('empty si no hay cards due', () => {
    const futureCard = {
      ...createInitialCard('c1', 'w1', 'altura', '2026-05-11'),
      nextReviewAt: '2027-01-01T00:00:00Z',
    };
    render(
      <SpacedRepetitionReviewQueue
        cards={[futureCard]}
        now="2026-05-11T00:00:00Z"
      />,
    );
    expect(screen.getByTestId('sr-queue-empty')).toBeInTheDocument();
  });

  it('renderiza primera card + botón reveal', () => {
    const dueCard = {
      ...createInitialCard('c1', 'w1', 'altura', '2026-05-10'),
      nextReviewAt: '2026-05-11T00:00:00Z',
    };
    render(
      <SpacedRepetitionReviewQueue
        cards={[dueCard]}
        now="2026-05-11T00:00:00Z"
      />,
    );
    expect(screen.getByTestId('sr-queue')).toBeInTheDocument();
    expect(screen.getByTestId('sr-topic').textContent).toBe('altura');
    expect(screen.getByTestId('sr-reveal')).toBeInTheDocument();
  });

  it('reveal muestra botones de rating', () => {
    const dueCard = {
      ...createInitialCard('c1', 'w1', 'altura', '2026-05-10'),
      nextReviewAt: '2026-05-11T00:00:00Z',
    };
    render(
      <SpacedRepetitionReviewQueue
        cards={[dueCard]}
        now="2026-05-11T00:00:00Z"
      />,
    );
    fireEvent.click(screen.getByTestId('sr-reveal'));
    expect(screen.getByTestId('sr-rating-buttons')).toBeInTheDocument();
  });

  it('rating dispara onUpdateCard', () => {
    const dueCard = {
      ...createInitialCard('c1', 'w1', 'altura', '2026-05-10'),
      nextReviewAt: '2026-05-11T00:00:00Z',
    };
    const onUpdate = vi.fn();
    render(
      <SpacedRepetitionReviewQueue
        cards={[dueCard]}
        now="2026-05-11T00:00:00Z"
        onUpdateCard={onUpdate}
      />,
    );
    fireEvent.click(screen.getByTestId('sr-reveal'));
    fireEvent.click(screen.getByTestId('sr-rate-ok'));
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });
});

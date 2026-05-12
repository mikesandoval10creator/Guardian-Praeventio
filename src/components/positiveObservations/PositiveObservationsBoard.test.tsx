// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PositiveObservationsBoard } from './PositiveObservationsBoard.js';
import type { PositiveObservation } from '../../services/positiveObservations/positiveObservationsService.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

function obs(over: Partial<PositiveObservation> & { id: string }): PositiveObservation {
  return {
    id: over.id,
    observedWorkerUid: over.observedWorkerUid ?? 'w1',
    observerUid: 'sup1',
    observerRole: 'supervisor',
    kind: over.kind ?? 'safe_behavior',
    description: 'd',
    observedAt: '2026-05-11T10:00:00Z',
    location: 'A',
    shared: false,
  };
}

describe('<PositiveObservationsBoard />', () => {
  it('renderiza counts y balance', () => {
    render(
      <PositiveObservationsBoard
        observations={[obs({ id: 'a' })]}
        correctiveCount={2}
      />,
    );
    expect(screen.getByTestId('positive-count').textContent).toBe('1');
    expect(screen.getByTestId('corrective-count').textContent).toBe('2');
  });

  it('recognitions ordenado por count', () => {
    render(
      <PositiveObservationsBoard
        observations={[
          obs({ id: 'a', observedWorkerUid: 'top' }),
          obs({ id: 'b', observedWorkerUid: 'top' }),
          obs({ id: 'c', observedWorkerUid: 'second' }),
        ]}
        correctiveCount={0}
      />,
    );
    expect(screen.getByTestId('positive-recognition-top')).toBeInTheDocument();
  });

  it('balance punitive si correctivas sin positivas', () => {
    render(<PositiveObservationsBoard observations={[]} correctiveCount={10} />);
    expect(screen.getByTestId('positive-obs-balance').textContent).toMatch(/punitive/);
  });

  it('onWorkerClick recibe uid', () => {
    const onClick = vi.fn();
    render(
      <PositiveObservationsBoard
        observations={[obs({ id: 'a', observedWorkerUid: 'w1' })]}
        correctiveCount={0}
        onWorkerClick={onClick}
      />,
    );
    fireEvent.click(screen.getByTestId('positive-recognition-w1'));
    expect(onClick).toHaveBeenCalledWith('w1');
  });
});

// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LeadershipTrailCard } from './LeadershipTrailCard.js';
import type { SupervisionDecision } from '../../services/leadership/supervisionDecisionTrail.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

function d(
  id: string,
  kind: SupervisionDecision['kind'],
  outcome?: { positive: boolean },
): SupervisionDecision {
  return {
    id,
    supervisorUid: 'sup-1',
    decidedAt: '2026-05-15T10:00:00Z',
    kind,
    context: `ctx ${id}`,
    rationale: `because ${id}`,
    outcome: outcome
      ? { ...outcome, description: 'd', recordedAt: '2026-05-15T11:00:00Z' }
      : undefined,
  };
}

describe('<LeadershipTrailCard />', () => {
  it('muestra el total', () => {
    render(
      <LeadershipTrailCard
        decisions={[d('a', 'stop_task'), d('b', 'reject_unsafe')]}
      />,
    );
    expect(screen.getByTestId('leadership-total').textContent).toMatch(/2/);
  });

  it('muestra estado vacío cuando no hay decisiones', () => {
    render(<LeadershipTrailCard decisions={[]} />);
    expect(screen.getByTestId('leadership-empty')).toBeInTheDocument();
  });

  it('calcula % positivo correctamente', () => {
    render(
      <LeadershipTrailCard
        decisions={[
          d('a', 'stop_task', { positive: true }),
          d('b', 'stop_task', { positive: true }),
          d('c', 'change_crew', { positive: false }),
          d('d', 'authorize_work'), // sin outcome
        ]}
      />,
    );
    // 2 positivos / 3 con outcome = 67%
    expect(screen.getByTestId('leadership-positive-rate').textContent).toMatch(
      /67/,
    );
    expect(screen.getByTestId('leadership-with-outcome').textContent).toMatch(
      /3/,
    );
  });

  it('renderiza top-5 impacto decisiones', () => {
    render(
      <LeadershipTrailCard
        decisions={[
          d('top', 'reject_unsafe', { positive: true }), // 30 + 5
          d('mid', 'stop_task'), // 25
        ]}
      />,
    );
    expect(screen.getByTestId('leadership-top-impact')).toBeInTheDocument();
    expect(screen.getByTestId('leadership-impact-top')).toBeInTheDocument();
    expect(screen.getByTestId('leadership-impact-mid')).toBeInTheDocument();
  });
});

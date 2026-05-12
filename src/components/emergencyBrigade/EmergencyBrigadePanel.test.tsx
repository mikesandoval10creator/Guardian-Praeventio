// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EmergencyBrigadePanel } from './EmergencyBrigadePanel.js';
import type {
  BrigadeMember,
  EmergencyResource,
} from '../../services/emergencyBrigade/emergencyBrigadeService.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

function member(over: Partial<BrigadeMember> & { workerUid: string }): BrigadeMember {
  return {
    workerUid: over.workerUid,
    role: over.role ?? 'brigade_chief',
    trainedAt: over.trainedAt ?? '2026-01-01T00:00:00Z',
    trainingValidYears: 2,
    active: true,
  };
}

function resource(id: string, operational: boolean = true): EmergencyResource {
  return {
    id,
    kind: 'extinguisher',
    location: 'A',
    lastInspectedAt: '2026-05-01',
    nextExpirationAt: '2027-01-01T00:00:00Z',
    operational,
  };
}

describe('<EmergencyBrigadePanel />', () => {
  it('meets minimum si chief + first_aid + fire', () => {
    render(
      <EmergencyBrigadePanel
        members={[
          member({ workerUid: 'a', role: 'brigade_chief' }),
          member({ workerUid: 'b', role: 'first_aid' }),
          member({ workerUid: 'c', role: 'fire_response' }),
        ]}
        resources={[]}
        requirements={[]}
      />,
    );
    expect(screen.getByTestId('brigade-meets-minimum')).toBeInTheDocument();
  });

  it('coverage fail si falta rol', () => {
    render(
      <EmergencyBrigadePanel
        members={[member({ workerUid: 'a', role: 'brigade_chief' })]}
        resources={[]}
        requirements={[]}
      />,
    );
    expect(screen.getByTestId('brigade-coverage-fail')).toBeInTheDocument();
  });

  it('muestra gaps de recursos', () => {
    render(
      <EmergencyBrigadePanel
        members={[]}
        resources={[resource('r1')]}
        requirements={[{ kind: 'extinguisher', minimumCount: 5 }]}
      />,
    );
    expect(screen.getByTestId('brigade-coverage-gaps')).toBeInTheDocument();
  });
});

// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LotoStatusPanel } from './LotoStatusPanel.js';
import type { LotoApplication } from '../../services/loto/lotoDigitalLight.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

function app(over: Partial<LotoApplication> = {}): LotoApplication {
  return {
    id: 'a1',
    equipmentId: 'eq1',
    leaderUid: 'leader',
    authorizedWorkerUids: ['w1'],
    energiesIdentified: ['electric'],
    lockPoints: [
      {
        pointId: 'p1',
        description: 'breaker',
        energyType: 'electric',
        appliedByUid: 'leader',
        appliedAt: '2026-05-11T08:00:00Z',
        tagId: 't1',
        zeroEnergyVerified: true,
      },
    ],
    appliedAt: '2026-05-11T08:00:00Z',
    workDescription: 'mantención',
    ...over,
  };
}

describe('<LotoStatusPanel />', () => {
  it('estado autorizado cuando todo OK', () => {
    render(<LotoStatusPanel application={app()} />);
    expect(screen.getByTestId('loto-state-badge')).toHaveTextContent('AUTORIZADO');
  });

  it('estado BLOQUEADO si zeroEnergy faltante', () => {
    const a = app({
      lockPoints: [
        {
          pointId: 'p1',
          description: 'x',
          energyType: 'electric',
          appliedByUid: 'l',
          appliedAt: 't',
          tagId: 't1',
          zeroEnergyVerified: false,
        },
      ],
    });
    render(<LotoStatusPanel application={a} />);
    expect(screen.getByTestId('loto-state-badge')).toHaveTextContent('BLOQUEADO');
  });

  it('estado LIBERADO cuando fullyReleased', () => {
    render(
      <LotoStatusPanel application={app({ fullyReleasedAt: '2026-05-11T16:00:00Z' })} />,
    );
    expect(screen.getByTestId('loto-state-badge')).toHaveTextContent('LIBERADO');
  });

  it('botón verify solo aparece para puntos NO verificados', () => {
    const a = app({
      lockPoints: [
        {
          pointId: 'p1',
          description: 'x',
          energyType: 'electric',
          appliedByUid: 'l',
          appliedAt: 't',
          tagId: 't1',
          zeroEnergyVerified: false,
        },
      ],
    });
    const onVerify = vi.fn();
    render(<LotoStatusPanel application={a} onVerifyZeroEnergy={onVerify} />);
    fireEvent.click(screen.getByTestId('loto-verify-p1'));
    expect(onVerify).toHaveBeenCalledWith('p1');
  });

  it('botón release solo aparece cuando authorizesWork', () => {
    const onRelease = vi.fn();
    render(<LotoStatusPanel application={app()} onRelease={onRelease} />);
    fireEvent.click(screen.getByTestId('loto-release'));
    expect(onRelease).toHaveBeenCalledTimes(1);
  });
});

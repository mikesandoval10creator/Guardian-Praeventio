// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ZoneEntryGate } from './ZoneEntryGate.js';
import type {
  RestrictedZone,
  ZoneEntryCheckInput,
} from '../../services/zones/restrictedZonesEngine.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

const NOW = new Date('2026-05-12T10:00:00Z');

const zone: RestrictedZone = {
  id: 'z1',
  kind: 'confined',
  name: 'Estanque B',
  activeFrom: '2026-05-12T00:00:00Z',
  rules: {
    requiredEpp: ['arnés', 'mascara_aire'],
    requiredTrainings: ['confined_space'],
    requiresPermit: true,
    responsibleUid: 'sup1',
  },
};

function input(over: Partial<ZoneEntryCheckInput> = {}): ZoneEntryCheckInput {
  return {
    workerUid: 'w1',
    workerEppLabels: [],
    workerTrainings: [],
    workerActivePermitKinds: [],
    zone,
    now: NOW,
    ...over,
  };
}

describe('<ZoneEntryGate />', () => {
  it('bloquea sin requisitos', () => {
    render(<ZoneEntryGate input={input()} />);
    expect(screen.getByTestId('zone-gate-z1')).toBeInTheDocument();
    expect(screen.getByTestId('zone-gate-status-z1').textContent).toBe('ENTRADA BLOQUEADA');
    expect(screen.getByTestId('zone-gate-missing-z1')).toBeInTheDocument();
  });

  it('permite con todos los requisitos', () => {
    render(
      <ZoneEntryGate
        input={input({
          workerEppLabels: ['arnés', 'mascara_aire'],
          workerTrainings: ['confined_space'],
          workerActivePermitKinds: ['confinado'],
        })}
      />,
    );
    expect(screen.getByTestId('zone-gate-status-z1').textContent).toBe('ENTRADA PERMITIDA');
  });

  it('dispara onAcknowledge cuando allowed', () => {
    const onAck = vi.fn();
    render(
      <ZoneEntryGate
        input={input({
          workerEppLabels: ['arnés', 'mascara_aire'],
          workerTrainings: ['confined_space'],
          workerActivePermitKinds: ['confinado'],
        })}
        onAcknowledge={onAck}
      />,
    );
    fireEvent.click(screen.getByTestId('zone-gate-ack-z1'));
    expect(onAck).toHaveBeenCalled();
  });
});

// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FaenaStateBanner } from './FaenaStateBanner.js';
import type { FaenaStateInput } from '../../services/operationalState/faenaStateEngine.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

function input(over: Partial<FaenaStateInput> = {}): FaenaStateInput {
  return {
    activeEmergencyIncidents: 0,
    activeStoppages: [],
    restrictedZones: [],
    criticalEquipmentDown: [],
    openCriticalFindings: 0,
    activeWorkPermits: 3,
    ...over,
  };
}

const NOW = new Date('2026-05-12T10:00:00Z');

describe('<FaenaStateBanner />', () => {
  it('estado operativa por default', () => {
    render(<FaenaStateBanner input={input()} now={NOW} />);
    const banner = screen.getByTestId('faena-state-banner');
    expect(banner).toHaveAttribute('data-state', 'operativa');
    expect(screen.getByTestId('faena-state-label')).toHaveTextContent('Operativa');
  });

  it('emergencia gana sobre cualquier otra señal', () => {
    render(
      <FaenaStateBanner
        input={input({
          activeEmergencyIncidents: 1,
          activeStoppages: [{ id: 's1', reason: 'X', sinceIso: '2026-05-10T00:00:00Z' }],
        })}
        now={NOW}
      />,
    );
    expect(screen.getByTestId('faena-state-banner')).toHaveAttribute(
      'data-state',
      'emergencia',
    );
  });

  it('detenida cuando hay paralización formal', () => {
    render(
      <FaenaStateBanner
        input={input({
          activeStoppages: [
            { id: 's1', reason: 'Auditoría', sinceIso: '2026-05-10T00:00:00Z' },
          ],
        })}
        now={NOW}
      />,
    );
    expect(screen.getByTestId('faena-state-banner')).toHaveAttribute(
      'data-state',
      'detenida',
    );
    expect(screen.getByTestId('faena-state-reason')).toHaveTextContent('Auditoría');
  });

  it('parcialmente detenida cuando hay equipo crítico down', () => {
    render(
      <FaenaStateBanner
        input={input({
          criticalEquipmentDown: [{ id: 'e1', label: 'Grúa 1' }],
        })}
        now={NOW}
      />,
    );
    expect(screen.getByTestId('faena-state-banner')).toHaveAttribute(
      'data-state',
      'parcialmente_detenida',
    );
    expect(screen.getByTestId('faena-state-modules')).toBeInTheDocument();
  });

  it('restringida cuando 2+ findings críticos abiertos', () => {
    render(
      <FaenaStateBanner input={input({ openCriticalFindings: 3 })} now={NOW} />,
    );
    expect(screen.getByTestId('faena-state-banner')).toHaveAttribute(
      'data-state',
      'restringida',
    );
  });
});

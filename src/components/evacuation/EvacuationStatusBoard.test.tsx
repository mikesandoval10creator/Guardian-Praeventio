// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EvacuationStatusBoard } from './EvacuationStatusBoard.js';
import type { EvacuationDrill } from '../../services/evacuation/evacuationHeadcount.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

const NOW = new Date('2026-05-12T10:05:00Z');

function drill(over: Partial<EvacuationDrill> = {}): EvacuationDrill {
  return {
    id: 'd1',
    projectId: 'p1',
    kind: 'drill',
    startedAt: '2026-05-12T10:00:00Z',
    startedByUid: 'u-super',
    meetingPointId: 'mp1',
    expectedWorkers: [
      { uid: 'w1', fullName: 'Ana' },
      { uid: 'w2', fullName: 'Bruno' },
      { uid: 'w3', fullName: 'Carla' },
    ],
    scans: [],
    ...over,
  };
}

describe('<EvacuationStatusBoard />', () => {
  it('renderiza cobertura inicial 0%', () => {
    render(<EvacuationStatusBoard drill={drill()} now={NOW} />);
    expect(screen.getByTestId('evacuation-board-d1')).toBeInTheDocument();
    expect(screen.getByTestId('evacuation-coverage-d1').textContent).toBe('0%');
  });

  it('renderiza safe vs missing', () => {
    render(
      <EvacuationStatusBoard
        drill={drill({
          scans: [
            { workerUid: 'w1', scannedAt: '2026-05-12T10:01:00Z', meetingPointId: 'mp1', scannedByUid: 'w1' },
          ],
        })}
        now={NOW}
      />,
    );
    expect(screen.getByTestId('evacuation-safe-w1')).toBeInTheDocument();
    expect(screen.getByTestId('evacuation-missing-w2')).toBeInTheDocument();
  });

  it('flag complete cuando 100%', () => {
    render(
      <EvacuationStatusBoard
        drill={drill({
          scans: [
            { workerUid: 'w1', scannedAt: '2026-05-12T10:01:00Z', meetingPointId: 'mp1', scannedByUid: 'w1' },
            { workerUid: 'w2', scannedAt: '2026-05-12T10:02:00Z', meetingPointId: 'mp1', scannedByUid: 'w2' },
            { workerUid: 'w3', scannedAt: '2026-05-12T10:03:00Z', meetingPointId: 'mp1', scannedByUid: 'w3' },
          ],
        })}
        now={NOW}
      />,
    );
    expect(screen.getByTestId('evacuation-complete-d1')).toBeInTheDocument();
  });

  it('muestra elapsed tiempo formato MM:SS', () => {
    render(<EvacuationStatusBoard drill={drill()} now={NOW} />);
    expect(screen.getByTestId('evacuation-elapsed-d1').textContent).toMatch(/05:00/);
  });
});

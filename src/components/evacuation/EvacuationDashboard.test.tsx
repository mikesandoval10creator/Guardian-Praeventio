// @vitest-environment jsdom
//
// Praeventio Guard — OLA 1 live evacuation board: start-gating + postmortem escape.
//
// Covers the props/behaviors added during the consolidation review:
//   - canStartNew=false disables the start buttons and shows startBlockedHint
//     (a roster-less count would report a false "100% / 0 missing" all-clear).
//   - canStartNew=true (default) enables start.
//   - After a drill ends, the postmortem stays on screen (never torn down) and a
//     "Iniciar nuevo conteo" button returns to the idle/start screen.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { EvacuationDashboard } from './EvacuationDashboard';
import type { EvacuationDrill } from '../../services/evacuation/evacuationHeadcount';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_k: string, fb?: string) => (typeof fb === 'string' ? fb : _k) }),
}));

const H = vi.hoisted(() => ({
  start: vi.fn(),
  scanQr: vi.fn(),
  end: vi.fn(),
  emitDrill: null as EvacuationDrill | null,
}));

vi.mock('../../hooks/useEvacuationHeadcount', () => ({
  useEvacuationHeadcount: () => ({ start: H.start, scanQr: H.scanQr, end: H.end }),
  subscribeToDrill: (
    _args: unknown,
    onUpdate: (d: EvacuationDrill | null) => void,
  ) => {
    if (H.emitDrill) onUpdate(H.emitDrill);
    return () => {};
  },
}));

vi.mock('./EvacuationQRScanner', () => ({ EvacuationQRScanner: () => <div data-testid="qr-scanner" /> }));

const baseProps = {
  projectId: 'p1',
  tenantId: 't1',
  expectedWorkers: [{ uid: 'w1', fullName: 'Ana' }],
  meetingPointId: 'mp-1',
};

function activeDrill(over: Partial<EvacuationDrill> = {}): EvacuationDrill {
  return {
    id: 'd1',
    projectId: 'p1',
    kind: 'drill',
    startedAt: new Date(Date.now() - 60_000).toISOString(),
    startedByUid: 'sup',
    meetingPointId: 'mp-1',
    expectedWorkers: [{ uid: 'w1', fullName: 'Ana' }],
    scans: [],
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  H.emitDrill = null;
});

describe('<EvacuationDashboard /> (live board)', () => {
  it('canStartNew=false → start buttons disabled + block hint shown', () => {
    render(<EvacuationDashboard {...baseProps} canStartNew={false} startBlockedHint="Sin asistencia hoy." />);
    expect(screen.getByTestId('evacuation-start-blocked').textContent).toMatch(/Sin asistencia/);
    expect((screen.getByTestId('evacuation-start-drill') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('evacuation-start-real') as HTMLButtonElement).disabled).toBe(true);
  });

  it('canStartNew=true (default) → start enabled, no block hint', () => {
    render(<EvacuationDashboard {...baseProps} />);
    expect(screen.queryByTestId('evacuation-start-blocked')).toBeNull();
    expect((screen.getByTestId('evacuation-start-drill') as HTMLButtonElement).disabled).toBe(false);
  });

  it('ending a drill keeps the postmortem on screen, then "Iniciar nuevo conteo" returns to idle', async () => {
    H.emitDrill = activeDrill();
    H.end.mockResolvedValueOnce({
      postmortem: {
        drillId: 'd1',
        kind: 'drill',
        totalExpected: 1,
        totalSafe: 1,
        finalCoveragePercent: 100,
        totalElapsedSec: 120,
        missingWorkers: [],
        averageTimeToScanSec: 30,
      },
    });
    // Resume an active drill so the active branch (with the End button) renders.
    render(<EvacuationDashboard {...baseProps} initialDrillId="d1" />);
    expect(screen.getByTestId('evacuation-dashboard-end-d1')).toBeTruthy();

    fireEvent.click(screen.getByTestId('evacuation-dashboard-end-d1'));

    // Postmortem renders AND stays (board not torn down).
    await waitFor(() => expect(screen.getByTestId('evacuation-dashboard-postmortem-d1')).toBeTruthy());
    expect(H.end).toHaveBeenCalledWith({ projectId: 'p1', drillId: 'd1' });

    // Escape back to idle to start a fresh count.
    fireEvent.click(screen.getByTestId('evacuation-postmortem-new'));
    await waitFor(() => expect(screen.getByTestId('evacuation-dashboard-idle')).toBeTruthy());
    expect(screen.queryByTestId('evacuation-dashboard-postmortem-d1')).toBeNull();
  });
});

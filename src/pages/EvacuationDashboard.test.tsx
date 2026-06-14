// @vitest-environment jsdom
//
// Praeventio Guard — OLA 1 evacuation dashboard CONSOLIDATION test (container).
//
// The page is a thin container around the LIVE server-backed board. The board
// owns the start→active→postmortem→idle lifecycle and is ALWAYS rendered once we
// can show it; the container only gates "can we show it at all" (project /
// tenant / active-drill-known) and passes roster-derived START enablement.
// Safety rules verified:
//   1. No roster ⇒ board renders but START is gated (canStartNew=false + hint) —
//      a roster-less count would report a false "100% / 0 missing" all-clear.
//   2. RESUME is by live query for the ACTIVE (non-ended) drill — an ended drill
//      is never resumed (no stale-marker lockout).
//   3. A failed active-drill lookup BLOCKS (no board) so no concurrent double-start.
//   4. No tenant claim ⇒ terminal guidance, never an infinite spinner.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { EvacuationDashboard } from './EvacuationDashboard';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_k: string, fb?: string) => (typeof fb === 'string' ? fb : _k) }),
}));

let mockProject: { id: string } | null = null;
let mockTenant: { tenantId: string | null; loading: boolean } = { tenantId: 'tenant-1', loading: false };
vi.mock('../contexts/ProjectContext', () => ({ useProject: () => ({ selectedProject: mockProject }) }));
vi.mock('../hooks/useTenantId', () => ({ useTenantId: () => mockTenant }));

let attendanceError = false;
let evacuationsError = false;
let evacuationsDocs: Array<Record<string, unknown>> = [];
const getDocs = vi.fn(async (arg: { path?: string }) => {
  const path = arg?.path ?? '';
  if (path.includes('/attendance')) {
    if (attendanceError) throw new Error('attendance-denied');
    return { docs: [] };
  }
  if (path.includes('/evacuations')) {
    if (evacuationsError) throw new Error('evacuations-denied');
    return { docs: evacuationsDocs.map((d) => ({ data: () => d })) };
  }
  return { docs: [] };
});
vi.mock('../services/firebase', () => ({
  db: {},
  collection: vi.fn((_db: unknown, path: string) => ({ path })),
  query: vi.fn((c: unknown) => c),
  where: vi.fn(() => ({})),
  getDocs: (...a: unknown[]) => getDocs(...(a as [{ path?: string }])),
}));

let mockRosterExpected: Array<{ uid: string; fullName: string }> = [];
vi.mock('../services/evacuation/rosterFromAttendance', () => ({
  buildEvacuationRoster: () => ({ expected: mockRosterExpected, safe: [], missing: [] }),
}));

vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

type BoardProps = {
  projectId: string;
  tenantId: string;
  expectedWorkers: unknown[];
  meetingPointId: string;
  initialDrillId?: string;
  canStartNew?: boolean;
  startBlockedHint?: string;
};
let boardProps: BoardProps | null = null;
vi.mock('../components/evacuation/EvacuationDashboard', () => ({
  EvacuationDashboard: (props: BoardProps) => {
    boardProps = props;
    return (
      <div
        data-testid="liveBoard"
        data-can-start={String(props.canStartNew)}
        data-initial={props.initialDrillId ?? ''}
        data-blocked={props.startBlockedHint ?? ''}
      />
    );
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockProject = { id: 'proj-1' };
  mockTenant = { tenantId: 'tenant-1', loading: false };
  mockRosterExpected = [];
  evacuationsDocs = [];
  attendanceError = false;
  evacuationsError = false;
  boardProps = null;
});

describe('<EvacuationDashboard /> consolidation container', () => {
  it('no project → no-project state, no board', () => {
    mockProject = null;
    render(<EvacuationDashboard />);
    expect(screen.getByTestId('evacDashboard.noProject')).toBeTruthy();
    expect(screen.queryByTestId('liveBoard')).toBeNull();
  });

  it('tenant claim still loading → spinner', () => {
    mockTenant = { tenantId: null, loading: true };
    render(<EvacuationDashboard />);
    expect(screen.getByTestId('evacDashboard.loading')).toBeTruthy();
    expect(screen.queryByTestId('liveBoard')).toBeNull();
  });

  it('signed in WITHOUT a tenant claim → terminal guidance, not an infinite spinner', () => {
    mockTenant = { tenantId: null, loading: false };
    render(<EvacuationDashboard />);
    expect(screen.getByTestId('evacDashboard.noTenant')).toBeTruthy();
    expect(screen.queryByTestId('liveBoard')).toBeNull();
  });

  it('roster ready, no active drill → board with start ENABLED, no block hint', async () => {
    mockRosterExpected = [
      { uid: 'w1', fullName: 'Ana' },
      { uid: 'w2', fullName: 'Bruno' },
    ];
    render(<EvacuationDashboard />);
    await waitFor(() => expect(screen.getByTestId('liveBoard')).toBeTruthy());
    expect(boardProps!.canStartNew).toBe(true);
    expect(boardProps!.startBlockedHint).toBeUndefined();
    expect(boardProps!.expectedWorkers).toHaveLength(2);
    expect(boardProps!.initialDrillId).toBeUndefined();
  });

  it('NO attendance → board still renders but START is gated (canStartNew=false + hint)', async () => {
    mockRosterExpected = [];
    render(<EvacuationDashboard />);
    await waitFor(() => expect(screen.getByTestId('liveBoard')).toBeTruthy());
    expect(boardProps!.canStartNew).toBe(false);
    expect(boardProps!.startBlockedHint).toBeTruthy();
  });

  it('attendance fetch fails → board renders, START gated + hint (failure not masked)', async () => {
    attendanceError = true;
    render(<EvacuationDashboard />);
    await waitFor(() => expect(screen.getByTestId('liveBoard')).toBeTruthy());
    expect(boardProps!.canStartNew).toBe(false);
    expect(boardProps!.startBlockedHint).toBeTruthy();
  });

  it('an ENDED drill is never resumed (no lockout) — board renders without initialDrillId', async () => {
    mockRosterExpected = [{ uid: 'w1', fullName: 'Ana' }];
    evacuationsDocs = [{ id: 'd-ended', startedAt: '2026-06-14T08:00:00Z', endedAt: '2026-06-14T09:00:00Z' }];
    render(<EvacuationDashboard />);
    await waitFor(() => expect(screen.getByTestId('liveBoard')).toBeTruthy());
    expect(boardProps!.initialDrillId).toBeUndefined();
  });

  it('an ACTIVE drill resumes via query even with an empty roster (board shown, start still gated)', async () => {
    mockRosterExpected = [];
    evacuationsDocs = [{ id: 'd-active', startedAt: '2026-06-14T08:00:00Z' }];
    render(<EvacuationDashboard />);
    await waitFor(() => expect(screen.getByTestId('liveBoard')).toBeTruthy());
    expect(boardProps!.initialDrillId).toBe('d-active');
    expect(boardProps!.canStartNew).toBe(false); // empty roster still gates a NEW start
  });

  it('active-drill lookup FAILS → blocking guidance, NO board (prevents double-start)', async () => {
    mockRosterExpected = [{ uid: 'w1', fullName: 'Ana' }];
    evacuationsError = true;
    render(<EvacuationDashboard />);
    await waitFor(() => expect(screen.getByTestId('evacDashboard.lookupError')).toBeTruthy());
    expect(screen.queryByTestId('liveBoard')).toBeNull();
  });

  it('retry after a lookup failure re-queries and recovers', async () => {
    mockRosterExpected = [{ uid: 'w1', fullName: 'Ana' }];
    evacuationsError = true;
    render(<EvacuationDashboard />);
    await waitFor(() => expect(screen.getByTestId('evacDashboard.lookupError')).toBeTruthy());
    evacuationsError = false;
    fireEvent.click(screen.getByTestId('evacDashboard.lookupRetry'));
    await waitFor(() => expect(screen.getByTestId('liveBoard')).toBeTruthy());
  });
});

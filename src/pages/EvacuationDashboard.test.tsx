// @vitest-environment jsdom
//
// Praeventio Guard — OLA 1 evacuation dashboard CONSOLIDATION test.
//
// The page is a thin container around the LIVE server-backed board (real-time +
// audited), replacing the IndexedDB single-device implementation. Verifies the
// two safety rules from the adversarial review:
//   1. A headcount needs a ROSTER — no attendance ⇒ honest guidance, NO startable
//      board (an empty roster would report a false "100% / 0 missing" all-clear).
//   2. RESUME is by live query for the ACTIVE (non-ended) drill — an ended drill
//      is never resumed (no stale-marker lockout); ending in-session returns to
//      the start screen.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { EvacuationDashboard } from './EvacuationDashboard';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_k: string, fb?: string) => (typeof fb === 'string' ? fb : _k) }),
}));

let mockProject: { id: string } | null = null;
let mockTenant: { tenantId: string | null; loading: boolean } = { tenantId: 'tenant-1', loading: false };
vi.mock('../contexts/ProjectContext', () => ({ useProject: () => ({ selectedProject: mockProject }) }));
vi.mock('../hooks/useTenantId', () => ({ useTenantId: () => mockTenant }));

let attendanceError = false;
let evacuationsDocs: Array<Record<string, unknown>> = [];
const getDocs = vi.fn(async (arg: { path?: string }) => {
  const path = arg?.path ?? '';
  if (path.includes('/attendance')) {
    if (attendanceError) throw new Error('attendance-denied');
    return { docs: [] }; // buildEvacuationRoster is mocked → roster comes from mockRosterExpected
  }
  if (path.includes('/evacuations')) {
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
  onDrillIdChange?: (id: string | null) => void;
};
let boardProps: BoardProps | null = null;
vi.mock('../components/evacuation/EvacuationDashboard', () => ({
  EvacuationDashboard: (props: BoardProps) => {
    boardProps = props;
    return (
      <div
        data-testid="liveBoard"
        data-tenant={props.tenantId}
        data-expected={props.expectedWorkers.length}
        data-initial={props.initialDrillId ?? ''}
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
  boardProps = null;
});

describe('<EvacuationDashboard /> consolidation container', () => {
  it('no project → no-project state, no board', () => {
    mockProject = null;
    render(<EvacuationDashboard />);
    expect(screen.getByTestId('evacDashboard.noProject')).toBeTruthy();
    expect(screen.queryByTestId('liveBoard')).toBeNull();
  });

  it('tenant claim still loading → spinner (board needs tenantId for the live path)', () => {
    mockTenant = { tenantId: null, loading: true };
    render(<EvacuationDashboard />);
    expect(screen.getByTestId('evacDashboard.loading')).toBeTruthy();
    expect(screen.queryByTestId('liveBoard')).toBeNull();
  });

  it('roster ready, no active drill → startable board with expectedWorkers + tenantId', async () => {
    mockRosterExpected = [
      { uid: 'w1', fullName: 'Ana' },
      { uid: 'w2', fullName: 'Bruno' },
    ];
    render(<EvacuationDashboard />);
    await waitFor(() => expect(screen.getByTestId('liveBoard')).toBeTruthy());
    expect(boardProps!.tenantId).toBe('tenant-1');
    expect(boardProps!.expectedWorkers).toHaveLength(2);
    expect(boardProps!.initialDrillId).toBeUndefined();
  });

  it('NO attendance + no active drill → honest guidance, NO startable board (avoids false all-clear)', async () => {
    mockRosterExpected = [];
    render(<EvacuationDashboard />);
    await waitFor(() => expect(screen.getByTestId('evacDashboard.noAttendance')).toBeTruthy());
    expect(screen.queryByTestId('liveBoard')).toBeNull();
  });

  it('attendance fetch fails + no active drill → error guidance (not silent), no startable board', async () => {
    attendanceError = true;
    render(<EvacuationDashboard />);
    await waitFor(() => expect(screen.getByTestId('evacDashboard.rosterError')).toBeTruthy());
    expect(screen.queryByTestId('liveBoard')).toBeNull();
  });

  it('an ENDED drill is never resumed (no stale-marker lockout) → shows guidance, not a dead board', async () => {
    mockRosterExpected = [];
    evacuationsDocs = [{ id: 'd-ended', startedAt: '2026-06-14T08:00:00Z', endedAt: '2026-06-14T09:00:00Z' }];
    render(<EvacuationDashboard />);
    await waitFor(() => expect(screen.getByTestId('evacDashboard.noAttendance')).toBeTruthy());
    expect(screen.queryByTestId('liveBoard')).toBeNull();
  });

  it('an ACTIVE drill resumes via query — even with an empty roster', async () => {
    mockRosterExpected = [];
    evacuationsDocs = [{ id: 'd-active', startedAt: '2026-06-14T08:00:00Z' }];
    render(<EvacuationDashboard />);
    await waitFor(() => expect(screen.getByTestId('liveBoard')).toBeTruthy());
    expect(boardProps!.initialDrillId).toBe('d-active');
  });

  it('onDrillIdChange(null) in-session (drill ended) returns to guidance when roster empty', async () => {
    mockRosterExpected = [];
    evacuationsDocs = [{ id: 'd-active', startedAt: '2026-06-14T08:00:00Z' }];
    render(<EvacuationDashboard />);
    await waitFor(() => expect(screen.getByTestId('liveBoard')).toBeTruthy());
    act(() => boardProps!.onDrillIdChange!(null));
    await waitFor(() => expect(screen.getByTestId('evacDashboard.noAttendance')).toBeTruthy());
    expect(screen.queryByTestId('liveBoard')).toBeNull();
  });
});

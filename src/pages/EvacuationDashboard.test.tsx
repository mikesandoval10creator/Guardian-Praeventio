// @vitest-environment jsdom
//
// Praeventio Guard — OLA 1 evacuation dashboard CONSOLIDATION test.
//
// The page is now a thin container around the LIVE server-backed board
// (real-time + audited), replacing the IndexedDB single-device implementation.
// Verifies: attendance pre-populates expectedWorkers; tenantId is resolved and
// passed; honest empty/error states when attendance is missing/unreadable;
// resume-across-reload via localStorage (board onDrillIdChange ⇄ marker).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { EvacuationDashboard } from './EvacuationDashboard';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_k: string, fb?: string) => (typeof fb === 'string' ? fb : _k) }),
}));

let mockProject: { id: string } | null = null;
let mockTenant: { tenantId: string | null; loading: boolean } = { tenantId: 'tenant-1', loading: false };
vi.mock('../contexts/ProjectContext', () => ({ useProject: () => ({ selectedProject: mockProject }) }));
vi.mock('../hooks/useTenantId', () => ({ useTenantId: () => mockTenant }));

const getDocs = vi.fn();
vi.mock('../services/firebase', () => ({
  db: {},
  collection: vi.fn((_db: unknown, path: string) => ({ path })),
  query: vi.fn((c: unknown) => c),
  where: vi.fn(() => ({})),
  getDocs: (...a: unknown[]) => getDocs(...a),
}));

let mockRosterExpected: Array<{ uid: string; fullName: string }> = [];
vi.mock('../services/evacuation/rosterFromAttendance', () => ({
  buildEvacuationRoster: () => ({ expected: mockRosterExpected, safe: [], missing: [] }),
}));

vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

// Stub the live board: capture props + expose onDrillIdChange.
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

function snap(records: Array<Record<string, unknown>>) {
  return { docs: records.map((r) => ({ data: () => r })) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockProject = { id: 'proj-1' };
  mockTenant = { tenantId: 'tenant-1', loading: false };
  mockRosterExpected = [];
  boardProps = null;
  getDocs.mockResolvedValue(snap([]));
  try {
    window.localStorage.clear();
  } catch {
    /* ignore */
  }
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

  it('attendance present → expectedWorkers + tenantId passed to the live board', async () => {
    mockRosterExpected = [
      { uid: 'w1', fullName: 'Ana' },
      { uid: 'w2', fullName: 'Bruno' },
    ];
    getDocs.mockResolvedValueOnce(snap([{ workerId: 'w1', type: 'Check-In', timestamp: '2026-06-14T08:00:00Z' }]));
    render(<EvacuationDashboard />);
    await waitFor(() => expect(screen.getByTestId('liveBoard')).toBeTruthy());
    expect(boardProps!.tenantId).toBe('tenant-1');
    expect(boardProps!.projectId).toBe('proj-1');
    expect(boardProps!.expectedWorkers).toHaveLength(2);
    expect(screen.queryByTestId('evacDashboard.noAttendance')).toBeNull();
  });

  it('no attendance → honest empty hint, board still rendered with empty roster', async () => {
    mockRosterExpected = [];
    render(<EvacuationDashboard />);
    await waitFor(() => expect(screen.getByTestId('evacDashboard.noAttendance')).toBeTruthy());
    expect(screen.getByTestId('liveBoard')).toBeTruthy();
    expect(boardProps!.expectedWorkers).toHaveLength(0);
  });

  it('attendance fetch fails → error hint (not silent), board still usable', async () => {
    getDocs.mockRejectedValueOnce(new Error('permission-denied'));
    render(<EvacuationDashboard />);
    await waitFor(() => expect(screen.getByTestId('evacDashboard.rosterError')).toBeTruthy());
    expect(screen.getByTestId('liveBoard')).toBeTruthy();
  });

  it('resumes an active drill from localStorage across reload', async () => {
    window.localStorage.setItem('praeventio:evac:active:proj-1', 'drill-xyz');
    render(<EvacuationDashboard />);
    await waitFor(() => expect(screen.getByTestId('liveBoard')).toBeTruthy());
    expect(boardProps!.initialDrillId).toBe('drill-xyz');
  });

  it('onDrillIdChange persists the active drill id and clears it on end', async () => {
    render(<EvacuationDashboard />);
    await waitFor(() => expect(screen.getByTestId('liveBoard')).toBeTruthy());
    boardProps!.onDrillIdChange!('drill-abc');
    expect(window.localStorage.getItem('praeventio:evac:active:proj-1')).toBe('drill-abc');
    boardProps!.onDrillIdChange!(null);
    expect(window.localStorage.getItem('praeventio:evac:active:proj-1')).toBeNull();
  });
});

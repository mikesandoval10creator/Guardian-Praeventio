// @vitest-environment jsdom
//
// Praeventio Guard — OLA 1 stop-work RESUME rewire (block #3) behavioral test.
//
// The dangerous legacy behavior this pins out of existence: when the last
// resumption precondition was marked fulfilled, the page AUTO-resumed the
// stoppage client-side with a hardcoded role 'supervisor' and a direct
// Firestore write — no human signature, no server authz, no audit. Resuming a
// stoppage is a JURIDICAL act; it must now go through the signed
// StoppageResumeModal → server-authoritative audited route.
//
// Verified here:
//   1. Marking the last precondition does NOT auto-resume (no status:'resumed'
//      write); it only persists the precondition + 'pending_resumption'.
//   2. A pending stoppage shows a "Firmar reanudación" CTA for an APPROVER role,
//      and clicking it opens the signed modal with the right props.
//   3. A non-approver role never sees the CTA — only the approver-only note.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { StoppageMonitor } from './StoppageMonitor';
import type { Stoppage } from '../services/stoppage/stoppageEngine';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fb?: unknown) =>
      typeof fb === 'string'
        ? fb
        : typeof (fb as { defaultValue?: string })?.defaultValue === 'string'
          ? (fb as { defaultValue: string }).defaultValue
          : _k,
  }),
}));

let mockUser: { uid: string } | null = { uid: 'uid-caller' };
let mockUserRole = 'supervisor';
vi.mock('../contexts/FirebaseContext', () => ({
  useFirebase: () => ({ user: mockUser, userRole: mockUserRole }),
}));

let mockProject: { id: string; name: string } | null = { id: 'proj-1', name: 'Proyecto Alfa' };
vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => ({ selectedProject: mockProject }),
}));

vi.mock('../components/stoppage/StoppageSummaryCard', () => ({
  StoppageSummaryCard: () => <div data-testid="summaryCard" />,
}));

// Mock the signed modal so the test focuses on StoppageMonitor's wiring: does it
// MOUNT the modal (with the right props) instead of auto-resuming?
type ModalProps = { open: boolean; projectId: string; stoppage: Stoppage; resumedByRole: string };
let modalProps: ModalProps | null = null;
vi.mock('../components/stoppage/StoppageResumeModal', () => ({
  StoppageResumeModal: (props: ModalProps) => {
    modalProps = props;
    return <div data-testid="resumeModalMounted" data-stoppage={props.stoppage.id} data-role={props.resumedByRole} />;
  },
}));

const updateStoppageStatus = vi.fn(async (..._a: unknown[]) => undefined);
const saveStoppage = vi.fn(async (..._a: unknown[]) => undefined);
let mockList: Stoppage[] = [];
let mockSubError = false;
vi.mock('../services/stoppage/stoppageStore', () => ({
  saveStoppage: (...a: unknown[]) => saveStoppage(...a),
  updateStoppageStatus: (...a: unknown[]) => updateStoppageStatus(...a),
  subscribeActiveStoppages: (
    _pid: string,
    onData: (list: Stoppage[]) => void,
    onError: (err: unknown) => void,
  ) => {
    if (mockSubError) onError(new Error('sub-denied'));
    else onData(mockList);
    return () => undefined;
  },
}));

vi.mock('../utils/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

function makeStoppage(over: Partial<Stoppage> = {}): Stoppage {
  return {
    id: 'stp-1',
    projectId: 'proj-1',
    category: 'detencion_voluntaria',
    scope: 'task',
    scopeTargetId: 'task-1',
    reason: 'Riesgo de caída en altura sin protección colectiva',
    declaredByUid: 'uid-worker',
    declaredByRole: 'operario',
    declaredAt: new Date('2026-06-01T08:00:00Z').toISOString(),
    status: 'active',
    resumptionPreconditions: [
      { id: 'pc-1', label: 'Inspección', fulfilled: false },
    ],
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUser = { uid: 'uid-caller' };
  mockUserRole = 'supervisor';
  mockProject = { id: 'proj-1', name: 'Proyecto Alfa' };
  mockList = [];
  mockSubError = false;
  modalProps = null;
});

describe('<StoppageMonitor /> resume rewire', () => {
  it('marking the LAST precondition does NOT auto-resume — only persists pending_resumption', async () => {
    mockList = [makeStoppage()]; // one active stoppage, one unfulfilled precondition
    render(<StoppageMonitor />);

    fireEvent.click(await screen.findByText('Marcar cumplida'));

    await waitFor(() => expect(updateStoppageStatus).toHaveBeenCalled());
    // It persists the precondition + the pending_resumption transition…
    expect(updateStoppageStatus).toHaveBeenCalledTimes(1);
    const patch = updateStoppageStatus.mock.calls[0][2] as Record<string, unknown>;
    expect(patch.status).toBe('pending_resumption');
    // …but NEVER auto-writes status:'resumed' (the removed dangerous behavior).
    const resumedWrite = updateStoppageStatus.mock.calls.find(
      (c) => (c[2] as Record<string, unknown>)?.status === 'resumed',
    );
    expect(resumedWrite).toBeUndefined();
  });

  it('a pending stoppage shows the signed-resume CTA for an APPROVER and opens the modal', async () => {
    mockUserRole = 'supervisor';
    mockList = [
      makeStoppage({
        status: 'pending_resumption',
        resumptionPreconditions: [{ id: 'pc-1', label: 'Inspección', fulfilled: true }],
      }),
    ];
    render(<StoppageMonitor />);

    const cta = await screen.findByTestId('stoppages.resumeSign');
    expect(cta).toBeTruthy();
    expect(screen.queryByTestId('resumeModalMounted')).toBeNull();

    fireEvent.click(cta);

    const modal = await screen.findByTestId('resumeModalMounted');
    expect(modal.getAttribute('data-stoppage')).toBe('stp-1');
    expect(modal.getAttribute('data-role')).toBe('supervisor');
    expect(modalProps?.projectId).toBe('proj-1');
  });

  it('a NON-approver role never sees the resume CTA — only the approver-only note', async () => {
    mockUserRole = 'operario';
    mockList = [
      makeStoppage({
        status: 'pending_resumption',
        resumptionPreconditions: [{ id: 'pc-1', label: 'Inspección', fulfilled: true }],
      }),
    ];
    render(<StoppageMonitor />);

    await screen.findByText(/debe firmarla un supervisor/i);
    expect(screen.queryByTestId('stoppages.resumeSign')).toBeNull();
  });

  it('a failed live subscription fails LOUD — shows an error and suppresses the false "all clear"', async () => {
    mockSubError = true;
    render(<StoppageMonitor />);

    await screen.findByTestId('stoppages.subError');
    // The misleading "no active stoppages" success state must NOT be shown when
    // the feed failed (a false negative on a life-safety list).
    expect(screen.queryByText(/no hay paralizaciones activas/i)).toBeNull();
  });
});

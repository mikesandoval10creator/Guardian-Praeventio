// @vitest-environment jsdom
//
// Praeventio Guard — OLA 1 stop-work behavioral tests (blocks #3 + declare hardening).
//
// RESUME rewire (#3): when the last resumption precondition was marked fulfilled
// the page used to AUTO-resume client-side with a hardcoded role 'supervisor' and
// a direct write — no signature, no server authz, no audit. Now: precondition
// marking + resume both go through AUDITED server routes; resume opens the signed
// modal.
//
// DECLARE hardening: declaring + marking-preconditions now go through the audited
// server routes (declaredByRole/verifierUid stamped from the token, id
// server-minted) instead of a client build with a hardcoded 'supervisor' role
// and a Math.random() id. Non-approvers may only declare voluntary stop-work.
//
// Verified here:
//   1. Marking the last precondition routes through the audited API (no
//      auto-resume, no status:'resumed' write).
//   2. A pending stoppage shows a "Firmar reanudación" CTA for an APPROVER and
//      opens the signed modal; a non-approver sees only the approver-only note.
//   3. Declare goes through the audited route (no client id/role) then persists.
//   4. A non-approver only sees the voluntary stop-work category.

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

// Audited server-route hooks the page declares/marks-preconditions through.
const declareStoppageApi = vi.fn();
const markStoppagePreconditionFulfilledApi = vi.fn();
vi.mock('../hooks/useStoppage', () => ({
  declareStoppageApi: (...a: unknown[]) => declareStoppageApi(...a),
  markStoppagePreconditionFulfilledApi: (...a: unknown[]) => markStoppagePreconditionFulfilledApi(...a),
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
  // Defaults: the audited routes succeed and return canonical stoppages.
  declareStoppageApi.mockResolvedValue({ stoppage: makeStoppage({ id: 'stp_server_1', status: 'active' }) });
  markStoppagePreconditionFulfilledApi.mockResolvedValue({
    stoppage: makeStoppage({
      status: 'pending_resumption',
      resumptionPreconditions: [{ id: 'pc-1', label: 'Inspección', fulfilled: true }],
    }),
  });
});

describe('<StoppageMonitor /> resume rewire', () => {
  it('marking a precondition routes through the AUDITED API, then persists — no auto-resume', async () => {
    mockList = [makeStoppage()]; // one active stoppage, one unfulfilled precondition
    render(<StoppageMonitor />);

    fireEvent.click(await screen.findByText('Marcar cumplida'));

    // It goes through the audited server route (verifierUid stamped server-side).
    await waitFor(() => expect(markStoppagePreconditionFulfilledApi).toHaveBeenCalledOnce());
    const [pid, input] = markStoppagePreconditionFulfilledApi.mock.calls[0];
    expect(pid).toBe('proj-1');
    expect((input as { preconditionId: string }).preconditionId).toBe('pc-1');
    // Then it persists the returned stoppage's pending_resumption transition…
    await waitFor(() => expect(updateStoppageStatus).toHaveBeenCalledTimes(1));
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

describe('<StoppageMonitor /> declare hardening', () => {
  it('declare goes through the AUDITED route (no client id/role), then persists the returned stoppage', async () => {
    mockUserRole = 'supervisor';
    declareStoppageApi.mockResolvedValueOnce({
      stoppage: makeStoppage({ id: 'stp_server_1', status: 'active' }),
    });
    render(<StoppageMonitor />);

    fireEvent.click(screen.getByRole('button', { name: /declarar paralización/i }));
    // Reason must be ≥15 chars to enable the submit.
    fireEvent.change(screen.getByPlaceholderText(/describí el riesgo/i), {
      target: { value: 'Riesgo de derrumbe en talud norte por lluvia intensa' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Declarar$/ }));

    await waitFor(() => expect(declareStoppageApi).toHaveBeenCalledOnce());
    const [pid, input] = declareStoppageApi.mock.calls[0];
    expect(pid).toBe('proj-1');
    // The client sends NO id and NO declaredByRole — the server stamps both.
    expect(input).not.toHaveProperty('id');
    expect(input).not.toHaveProperty('declaredByRole');
    expect((input as { category: string }).category).toBe('detencion_voluntaria');
    // The canonical (server-stamped id) stoppage the route returned is persisted.
    await waitFor(() => expect(saveStoppage).toHaveBeenCalledOnce());
    expect((saveStoppage.mock.calls[0][0] as Stoppage).id).toBe('stp_server_1');
  });

  it('a NON-approver only sees the voluntary stop-work category + a note (server-enforced)', async () => {
    mockUserRole = 'operario';
    render(<StoppageMonitor />);

    fireEvent.click(screen.getByRole('button', { name: /declarar paralización/i }));
    const select = screen.getByTestId('stoppages.form.category') as HTMLSelectElement;
    const options = Array.from(select.querySelectorAll('option'));
    expect(options).toHaveLength(1);
    expect(options[0].getAttribute('value')).toBe('detencion_voluntaria');
    expect(screen.getByText(/como trabajador podés declarar/i)).toBeTruthy();
  });

  it('an APPROVER sees all stoppage categories', async () => {
    mockUserRole = 'supervisor';
    render(<StoppageMonitor />);

    fireEvent.click(screen.getByRole('button', { name: /declarar paralización/i }));
    const select = screen.getByTestId('stoppages.form.category') as HTMLSelectElement;
    expect(select.querySelectorAll('option').length).toBeGreaterThan(1);
    expect(screen.queryByText(/como trabajador podés declarar/i)).toBeNull();
  });
});

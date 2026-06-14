// @vitest-environment jsdom
//
// Praeventio Guard — OLA 1 worker check-in page tests.
//
// Behavioral coverage for `<LoneWorker />` (the worker-facing surface at
// /lone-worker/check-in). Verifies: it renders the REAL audited check-in widget
// for the worker's own active session; an honest empty-state otherwise (no mock);
// starting persists; and — the adversarial-review fixes — the check-in persist
// path is exercised, a failed HELP persist FAILS LOUD (banner + rollback, never
// a silent downgrade), and a failed subscription read shows a distinct error
// state (not the start-empty-state that invites duplicate sessions).
//
// Hermetic: contexts, store, audited hook, FGS client, i18n mocked.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LoneWorker } from './LoneWorker';
import type { LoneWorkerSession } from '../services/loneWorker/loneWorkerService';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (
      _k: string,
      fallback?: string | Record<string, unknown>,
      opts?: Record<string, unknown>,
    ) => {
      if (typeof fallback === 'string') {
        if (opts && typeof opts === 'object') {
          let out = fallback;
          for (const [key, val] of Object.entries(opts)) {
            out = out.replace(`{{${key}}}`, String(val));
          }
          return out;
        }
        return fallback;
      }
      return _k;
    },
  }),
}));

let mockSelectedProject: { id: string; name: string } | null = null;
let mockUser: { uid: string } | null = null;
let mockActiveSessions: LoneWorkerSession[] = [];
let subMode: 'data' | 'error' = 'data';

vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => ({ selectedProject: mockSelectedProject }),
}));
vi.mock('../contexts/FirebaseContext', () => ({
  useFirebase: () => ({ user: mockUser }),
}));

const saveLoneWorkerSession = vi.fn().mockResolvedValue(undefined);
const patchLoneWorkerSession = vi.fn().mockResolvedValue(undefined);
const subscribeActiveLoneWorkerSessions = vi.fn(
  (
    _projectId: string,
    onData: (list: LoneWorkerSession[]) => void,
    onError?: (err: unknown) => void,
  ) => {
    if (subMode === 'error') onError?.(new Error('permission-denied'));
    else onData(mockActiveSessions);
    return () => {};
  },
);

vi.mock('../services/loneWorker/loneWorkerStore', () => ({
  subscribeActiveLoneWorkerSessions: (...args: unknown[]) =>
    (subscribeActiveLoneWorkerSessions as unknown as (...a: unknown[]) => unknown)(...args),
  saveLoneWorkerSession: (...args: unknown[]) => saveLoneWorkerSession(...args),
  patchLoneWorkerSession: (...args: unknown[]) => patchLoneWorkerSession(...args),
}));

// Audited check-in/end hook the widget posts through.
const recordLoneWorkerCheckIn = vi.fn();
const endLoneWorkerSession = vi.fn();
vi.mock('../hooks/useLoneWorker', () => ({
  recordLoneWorkerCheckIn: (...a: unknown[]) => recordLoneWorkerCheckIn(...a),
  endLoneWorkerSession: (...a: unknown[]) => endLoneWorkerSession(...a),
}));

const startLoneWorkerFgs = vi.fn().mockResolvedValue({ applied: false, reason: 'not_native' });
const stopLoneWorkerFgs = vi.fn().mockResolvedValue({ applied: true, reason: 'stopped' });
vi.mock('../services/mobile/foregroundServiceClient', () => ({
  startLoneWorkerFgs: (...args: unknown[]) => startLoneWorkerFgs(...args),
  stopLoneWorkerFgs: (...args: unknown[]) => stopLoneWorkerFgs(...args),
  isRunning: () => false,
  isAndroidNative: () => false,
}));

vi.mock('../utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

function session(over: Partial<LoneWorkerSession> = {}): LoneWorkerSession {
  return {
    id: 'lws_1',
    workerUid: 'worker-1',
    startedAt: '2026-06-14T11:00:00Z',
    checkInIntervalMin: 15,
    checkIns: [],
    status: 'active',
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSelectedProject = { id: 'proj-1', name: 'Faena Norte' };
  mockUser = { uid: 'worker-1' };
  mockActiveSessions = [];
  subMode = 'data';
  saveLoneWorkerSession.mockResolvedValue(undefined);
  patchLoneWorkerSession.mockResolvedValue(undefined);
});

describe('<LoneWorker /> worker check-in page', () => {
  it('no project selected → honest no-project state, no widget', async () => {
    mockSelectedProject = null;
    render(<LoneWorker />);
    expect(screen.getByTestId('loneWorker.noProject')).toBeTruthy();
    expect(screen.queryByTestId('loneWorker.widget')).toBeNull();
    expect(screen.getByTestId('loneWorker.fgs')).toBeTruthy();
  });

  it('worker has an active session → renders the real check-in widget', async () => {
    mockActiveSessions = [session({ workerUid: 'worker-1', checkInIntervalMin: 30 })];
    render(<LoneWorker />);
    await waitFor(() => expect(screen.getByTestId('loneWorker.widget')).toBeTruthy());
    expect(screen.queryByTestId('loneWorker.empty')).toBeNull();
  });

  it('active session belongs to ANOTHER worker → empty-state', async () => {
    mockActiveSessions = [session({ workerUid: 'someone-else' })];
    render(<LoneWorker />);
    await waitFor(() => expect(screen.getByTestId('loneWorker.empty')).toBeTruthy());
    expect(screen.queryByTestId('loneWorker.widget')).toBeNull();
  });

  it('no active session → start button persists a new session for the caller', async () => {
    mockActiveSessions = [];
    render(<LoneWorker />);
    const startBtn = await screen.findByTestId('loneWorker.start');
    fireEvent.click(startBtn);
    await waitFor(() => expect(saveLoneWorkerSession).toHaveBeenCalledOnce());
    const [projectIdArg, sessionArg] = saveLoneWorkerSession.mock.calls[0];
    expect(projectIdArg).toBe('proj-1');
    expect((sessionArg as LoneWorkerSession).workerUid).toBe('worker-1');
    expect((sessionArg as LoneWorkerSession).status).toBe('active');
  });

  it('start FAILURE → feedback shown, no widget (worker not falsely told session started)', async () => {
    mockActiveSessions = [];
    saveLoneWorkerSession.mockRejectedValueOnce(new Error('firestore down'));
    render(<LoneWorker />);
    fireEvent.click(await screen.findByTestId('loneWorker.start'));
    await waitFor(() => expect(saveLoneWorkerSession).toHaveBeenCalled());
    // setSession is reached only after a successful save → no widget on failure.
    expect(screen.queryByTestId('loneWorker.widget')).toBeNull();
    expect(screen.getByTestId('loneWorker.empty')).toBeTruthy();
  });

  it('check-in OK → audited route result is persisted to Firestore (monitor stays in sync)', async () => {
    mockActiveSessions = [session()];
    recordLoneWorkerCheckIn.mockResolvedValueOnce({
      session: session({ checkIns: [{ at: '2026-06-14T11:05:00Z', status: 'ok' }] }),
    });
    render(<LoneWorker />);
    fireEvent.click(await screen.findByTestId('loneWorker.widget.checkIn'));
    await waitFor(() => expect(patchLoneWorkerSession).toHaveBeenCalledOnce());
    const [pid, sid, patch] = patchLoneWorkerSession.mock.calls[0];
    expect(pid).toBe('proj-1');
    expect(sid).toBe('lws_1');
    expect((patch as { checkIns: unknown[] }).checkIns).toHaveLength(1);
    expect(screen.queryByTestId('loneWorker.persistError')).toBeNull();
  });

  it('HELP press whose persist FAILS → fails LOUD (help banner), never silently dropped', async () => {
    mockActiveSessions = [session()];
    recordLoneWorkerCheckIn.mockResolvedValueOnce({
      session: session({
        status: 'help_requested',
        checkIns: [{ at: '2026-06-14T11:05:00Z', status: 'help' }],
      }),
    });
    patchLoneWorkerSession.mockRejectedValueOnce(new Error('offline'));
    render(<LoneWorker />);
    fireEvent.click(await screen.findByTestId('loneWorker.widget.help'));
    // The failed help persist must surface a prominent alert (not a silent toast).
    const banner = await screen.findByTestId('loneWorker.persistError');
    expect(banner.getAttribute('role')).toBe('alert');
    expect(banner.textContent).toMatch(/AYUDA/);
    // Rolled back to the still-active session → the widget remains mounted.
    expect(screen.getByTestId('loneWorker.widget')).toBeTruthy();
  });

  it('subscription READ failure → distinct error state (NOT the start-empty-state), retry re-subscribes', async () => {
    mockActiveSessions = [session()];
    subMode = 'error';
    render(<LoneWorker />);
    await waitFor(() => expect(screen.getByTestId('loneWorker.subError')).toBeTruthy());
    // Must NOT show the empty/start state (which would invite a duplicate session).
    expect(screen.queryByTestId('loneWorker.empty')).toBeNull();
    expect(screen.queryByTestId('loneWorker.start')).toBeNull();
    // Retry re-subscribes; this time the read succeeds → widget appears.
    subMode = 'data';
    fireEvent.click(screen.getByTestId('loneWorker.subRetry'));
    await waitFor(() => expect(screen.getByTestId('loneWorker.widget')).toBeTruthy());
    expect(screen.queryByTestId('loneWorker.subError')).toBeNull();
  });

  it('starts the Android foreground service on mount', async () => {
    render(<LoneWorker />);
    await waitFor(() =>
      expect(startLoneWorkerFgs).toHaveBeenCalledWith(
        expect.objectContaining({ workerUid: 'worker-1' }),
      ),
    );
  });
});

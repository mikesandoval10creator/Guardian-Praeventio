// @vitest-environment jsdom
//
// Praeventio Guard — OLA 1 worker check-in page tests.
//
// Behavioral coverage for `<LoneWorker />` (the worker-facing surface at
// /lone-worker/check-in, split out of the route collision with the supervisor
// monitor). Verifies it renders the REAL audited check-in widget for the
// worker's own active session, shows an honest empty-state otherwise (NO mock
// session), and that starting a session persists via the store.
//
// Hermetic: contexts, store, FGS client, i18n mocked. No Firestore, no fetch.

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
  ) => {
    onData(mockActiveSessions);
    return () => {};
  },
);

vi.mock('../services/loneWorker/loneWorkerStore', () => ({
  subscribeActiveLoneWorkerSessions: (...args: unknown[]) =>
    (subscribeActiveLoneWorkerSessions as unknown as (...a: unknown[]) => unknown)(...args),
  saveLoneWorkerSession: (...args: unknown[]) => saveLoneWorkerSession(...args),
  patchLoneWorkerSession: (...args: unknown[]) => patchLoneWorkerSession(...args),
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
});

describe('<LoneWorker /> worker check-in page', () => {
  it('no project selected → honest no-project state, no widget', async () => {
    mockSelectedProject = null;
    render(<LoneWorker />);
    expect(screen.getByTestId('loneWorker.noProject')).toBeTruthy();
    expect(screen.queryByTestId('loneWorker.widget')).toBeNull();
    // FGS controls still render (process survival is project-independent).
    expect(screen.getByTestId('loneWorker.fgs')).toBeTruthy();
  });

  it('worker has an active session → renders the real check-in widget', async () => {
    mockActiveSessions = [session({ workerUid: 'worker-1', checkInIntervalMin: 30 })];
    render(<LoneWorker />);
    await waitFor(() => expect(screen.getByTestId('loneWorker.widget')).toBeTruthy());
    // No fabricated mock card / empty-state when a real session exists.
    expect(screen.queryByTestId('loneWorker.empty')).toBeNull();
    expect(subscribeActiveLoneWorkerSessions).toHaveBeenCalledWith(
      'proj-1',
      expect.any(Function),
      expect.any(Function),
    );
  });

  it('active session belongs to ANOTHER worker → not actionable, empty-state', async () => {
    mockActiveSessions = [session({ workerUid: 'someone-else' })];
    render(<LoneWorker />);
    await waitFor(() => expect(screen.getByTestId('loneWorker.empty')).toBeTruthy());
    expect(screen.queryByTestId('loneWorker.widget')).toBeNull();
  });

  it('no active session → empty-state start button persists a new session for the caller', async () => {
    mockActiveSessions = [];
    render(<LoneWorker />);
    const startBtn = await screen.findByTestId('loneWorker.start');
    fireEvent.click(startBtn);
    await waitFor(() => expect(saveLoneWorkerSession).toHaveBeenCalledOnce());
    const [projectIdArg, sessionArg] = saveLoneWorkerSession.mock.calls[0];
    expect(projectIdArg).toBe('proj-1');
    expect((sessionArg as LoneWorkerSession).workerUid).toBe('worker-1');
    expect((sessionArg as LoneWorkerSession).status).toBe('active');
    expect((sessionArg as LoneWorkerSession).checkInIntervalMin).toBe(15);
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

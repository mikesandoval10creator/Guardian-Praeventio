// @vitest-environment jsdom
//
// Praeventio Guard — LoneWorkerMonitor START-session audit test (block #4).
//
// The supervisor monitor page (routed at /lone-worker) is the SECOND reachable
// lone-worker start path. Like the worker page, starting a session must go
// through the AUDITED server route (which stamps workerUid from the token +
// mints the id server-side + writes audit_logs) — not a client-side build with
// a Math.random() id and a direct Firestore write. This pins that: the start
// goes through startLoneWorkerSessionApi FIRST, then persists the returned
// canonical session; a route failure blocks before any persist.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LoneWorkerMonitor } from './LoneWorkerMonitor';
import type { LoneWorkerSession } from '../services/loneWorker/loneWorkerService';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fb?: unknown, opts?: Record<string, unknown>) => {
      const base =
        typeof fb === 'string'
          ? fb
          : fb && typeof fb === 'object' && 'defaultValue' in (fb as Record<string, unknown>)
            ? String((fb as { defaultValue: unknown }).defaultValue)
            : key;
      let out = String(base);
      const interp =
        opts && typeof opts === 'object'
          ? opts
          : fb && typeof fb === 'object'
            ? (fb as Record<string, unknown>)
            : undefined;
      if (interp) {
        for (const [k, v] of Object.entries(interp)) out = out.replace(`{{${k}}}`, String(v));
      }
      return out;
    },
  }),
}));

let mockUser: { uid: string } | null = { uid: 'worker-1' };
let mockProject: { id: string; name: string } | null = { id: 'proj-1', name: 'Faena Norte' };
vi.mock('../contexts/FirebaseContext', () => ({ useFirebase: () => ({ user: mockUser }) }));
vi.mock('../contexts/ProjectContext', () => ({ useProject: () => ({ selectedProject: mockProject }) }));

vi.mock('../components/loneWorker/LoneWorkerCard', () => ({
  LoneWorkerCard: () => <div data-testid="lwCard" />,
}));

const saveLoneWorkerSession = vi.fn(async (..._a: unknown[]) => undefined);
const patchLoneWorkerSession = vi.fn(async (..._a: unknown[]) => undefined);
vi.mock('../services/loneWorker/loneWorkerStore', () => ({
  saveLoneWorkerSession: (...a: unknown[]) => saveLoneWorkerSession(...a),
  patchLoneWorkerSession: (...a: unknown[]) => patchLoneWorkerSession(...a),
  subscribeActiveLoneWorkerSessions: (
    _pid: string,
    onData: (list: LoneWorkerSession[]) => void,
  ) => {
    onData([]);
    return () => undefined;
  },
}));

const startLoneWorkerSessionApi = vi.fn();
const fetchLoneWorkerAdminOverview = vi.fn(async (..._a: unknown[]) => ({ overview: [] }));
vi.mock('../hooks/useLoneWorker', () => ({
  startLoneWorkerSessionApi: (...a: unknown[]) => startLoneWorkerSessionApi(...a),
  fetchLoneWorkerAdminOverview: (...a: unknown[]) => fetchLoneWorkerAdminOverview(...a),
}));

vi.mock('../utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

function session(over: Partial<LoneWorkerSession> = {}): LoneWorkerSession {
  return {
    id: 'lws_server_9',
    workerUid: 'worker-1',
    startedAt: '2026-06-14T11:00:00Z',
    checkInIntervalMin: 30,
    checkIns: [],
    status: 'active',
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUser = { uid: 'worker-1' };
  mockProject = { id: 'proj-1', name: 'Faena Norte' };
  startLoneWorkerSessionApi.mockResolvedValue({ session: session() });
  fetchLoneWorkerAdminOverview.mockResolvedValue({ overview: [] });
  saveLoneWorkerSession.mockResolvedValue(undefined);
});

async function openFormAndSubmit() {
  fireEvent.click(await screen.findByRole('button', { name: /^Iniciar sesión$/ }));
  fireEvent.click(await screen.findByRole('button', { name: /^Iniciar$/ }));
}

describe('<LoneWorkerMonitor /> start-session audit', () => {
  it('start goes through the AUDITED route FIRST, then persists the returned session', async () => {
    startLoneWorkerSessionApi.mockResolvedValueOnce({
      session: session({ id: 'lws_server_9', workerUid: 'worker-1' }),
    });
    render(<LoneWorkerMonitor />);
    await openFormAndSubmit();

    await waitFor(() => expect(startLoneWorkerSessionApi).toHaveBeenCalledOnce());
    const [pid, input] = startLoneWorkerSessionApi.mock.calls[0];
    expect(pid).toBe('proj-1');
    expect((input as { checkInIntervalMin: number }).checkInIntervalMin).toBe(30);
    // The canonical session the audited route returned is what gets persisted.
    await waitFor(() => expect(saveLoneWorkerSession).toHaveBeenCalledOnce());
    const [persistPid, persisted] = saveLoneWorkerSession.mock.calls[0];
    expect(persistPid).toBe('proj-1');
    expect((persisted as LoneWorkerSession).id).toBe('lws_server_9');
    expect((persisted as LoneWorkerSession).workerUid).toBe('worker-1');
  });

  it('start BLOCKED by the audited route → no persist (no untraced session)', async () => {
    startLoneWorkerSessionApi.mockRejectedValueOnce(new Error('forbidden'));
    render(<LoneWorkerMonitor />);
    await openFormAndSubmit();

    await waitFor(() => expect(startLoneWorkerSessionApi).toHaveBeenCalled());
    // The audited gate failed → nothing is written to Firestore.
    expect(saveLoneWorkerSession).not.toHaveBeenCalled();
  });
});

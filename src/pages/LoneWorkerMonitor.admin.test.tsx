// @vitest-environment jsdom
//
// Praeventio Guard — LoneWorkerMonitor admin-panel mount test.
//
// Pins that the supervisor overview (<LoneWorkerAdminPanel />) is REAL on the
// /lone-worker page:
//   1. It renders the project's REAL lone-worker sessions — the exact list the
//      page's Firestore subscription (subscribeActiveLoneWorkerSessions) emits.
//   2. The per-row status + escalation come from the SERVER admin-overview call
//      (fetchLoneWorkerAdminOverview), the authoritative-clock source — not a
//      client re-derivation. We assert the panel calls it with that real list
//      and the projectId, and renders the server-returned rows.
//   3. Honest empty-state when the project has no live sessions.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { LoneWorkerMonitor } from './LoneWorkerMonitor';
import type {
  LoneWorkerSession,
} from '../services/loneWorker/loneWorkerService';
import type { AdminOverviewEntry } from '../hooks/useLoneWorker';

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

const mockUser: { uid: string } = { uid: 'worker-1' };
const mockProject: { id: string; name: string } = { id: 'proj-1', name: 'Faena Norte' };
vi.mock('../contexts/FirebaseContext', () => ({ useFirebase: () => ({ user: mockUser }) }));
vi.mock('../contexts/ProjectContext', () => ({ useProject: () => ({ selectedProject: mockProject }) }));

// Keep the per-session card a stub — this test is about the admin panel, which
// is rendered for real (NOT mocked).
vi.mock('../components/loneWorker/LoneWorkerCard', () => ({
  LoneWorkerCard: () => <div data-testid="lwCard" />,
}));

// The REAL session list the supervisor page subscribes to from Firestore.
const liveSessions: LoneWorkerSession[] = [
  {
    id: 'lws_overdue_42',
    workerUid: 'worker-9',
    startedAt: '2026-06-20T08:00:00Z',
    checkInIntervalMin: 30,
    checkIns: [{ at: '2026-06-20T08:05:00Z', status: 'ok' }],
    status: 'active',
  },
];

let subscribedProjectId: string | null = null;
vi.mock('../services/loneWorker/loneWorkerStore', () => ({
  saveLoneWorkerSession: vi.fn(async () => undefined),
  patchLoneWorkerSession: vi.fn(async () => undefined),
  subscribeActiveLoneWorkerSessions: (
    pid: string,
    onData: (list: LoneWorkerSession[]) => void,
  ) => {
    subscribedProjectId = pid;
    onData(liveSessions);
    return () => undefined;
  },
}));

const startLoneWorkerSessionApi = vi.fn(async (..._a: unknown[]) => ({ session: liveSessions[0] }));
const fetchLoneWorkerAdminOverview = vi.fn((..._a: unknown[]) => Promise.resolve({ overview: [] as AdminOverviewEntry[] }));
vi.mock('../hooks/useLoneWorker', () => ({
  startLoneWorkerSessionApi: (...a: unknown[]) => startLoneWorkerSessionApi(...a),
  fetchLoneWorkerAdminOverview: (...a: unknown[]) => fetchLoneWorkerAdminOverview(...a),
}));

vi.mock('../utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

beforeEach(() => {
  vi.clearAllMocks();
  subscribedProjectId = null;
});

describe('<LoneWorkerMonitor /> supervisor admin panel', () => {
  it('feeds the REAL subscribed sessions to the server admin-overview and renders its rows', async () => {
    // The SERVER (authoritative clock) returns the derived status + escalation.
    const overview: AdminOverviewEntry[] = [
      {
        session: liveSessions[0],
        status: 'overdue_critical',
        escalation: {
          level: 'brigade',
          message: 'Trabajador worker-9 sin contacto — activar brigada',
          triggeredAt: '2026-06-20T09:30:00Z',
        },
      },
    ];
    fetchLoneWorkerAdminOverview.mockResolvedValue({ overview });

    render(<LoneWorkerMonitor />);

    // The panel section is mounted on the supervisor page.
    expect(await screen.findByTestId('lone_worker_page.admin_section')).toBeTruthy();
    expect(screen.getByTestId('loneWorker.admin')).toBeTruthy();

    // It asked the SERVER for status/escalation, passing the REAL session list
    // (from the Firestore subscription) and the active project id.
    await waitFor(() => expect(fetchLoneWorkerAdminOverview).toHaveBeenCalled());
    const [pid, input] = fetchLoneWorkerAdminOverview.mock.calls[0] as [
      string,
      { sessions: LoneWorkerSession[] },
    ];
    expect(pid).toBe('proj-1');
    expect(subscribedProjectId).toBe('proj-1');
    expect(input.sessions).toHaveLength(1);
    expect(input.sessions[0].id).toBe('lws_overdue_42');

    // The server-derived row for that real session is rendered (precise id,
    // no getAllBy fallback).
    const row = await screen.findByTestId('loneWorker.admin.row.lws_overdue_42');
    expect(row.textContent).toContain('worker-9');
    expect(row.textContent).toContain('30 min');
    // The server-authoritative critical status surfaces, not a client guess.
    expect(row.textContent).toContain('Crítico');
    // Escalation level travels with the row.
    expect(row.textContent?.toLowerCase()).toContain('brigade');
  });

  it('shows the honest empty-state when the server returns no overview rows', async () => {
    fetchLoneWorkerAdminOverview.mockResolvedValue({ overview: [] });

    render(<LoneWorkerMonitor />);

    expect(await screen.findByTestId('loneWorker.admin')).toBeTruthy();
    await waitFor(() => expect(fetchLoneWorkerAdminOverview).toHaveBeenCalled());
    expect(await screen.findByTestId('loneWorker.admin.empty')).toBeTruthy();
  });
});

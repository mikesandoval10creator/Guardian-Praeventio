import { describe, it, expect, vi } from 'vitest';
import { runLoneWorkerEscalationCron } from './runLoneWorkerEscalation.js';
import type { LoneWorkerSession } from '../../services/loneWorker/loneWorkerService.js';

// ────────────────────────────────────────────────────────────────────────
// Fake Firestore (minimal lone-worker shape)
// ────────────────────────────────────────────────────────────────────────

function buildDb(opts: {
  sessions: Array<{ id: string; session: LoneWorkerSession; existingEscalationKey?: string }>;
  /** Path expected by the caller. Defaults to root (legacy default). */
  expectedCollectionPath?: string;
}) {
  const writes: Array<{ path: string; data: unknown }> = [];
  const expected = opts.expectedCollectionPath ?? 'lone_worker_sessions';

  const sessionsCol = {
    where(_field: string, _op: string, _val: unknown) {
      return {
        async get() {
          return {
            size: opts.sessions.length,
            docs: opts.sessions.map((s) => ({
              id: s.id,
              data: () => s.session,
            })),
          };
        },
      };
    },
    doc(sessionId: string) {
      return {
        collection(name: string) {
          if (name !== 'escalations') throw new Error('unexpected subcoll');
          return {
            doc(key: string) {
              const existing = opts.sessions.find(
                (s) => s.id === sessionId && s.existingEscalationKey === key,
              );
              return {
                async get() {
                  return { exists: Boolean(existing) };
                },
                async set(data: unknown) {
                  writes.push({ path: `${expected}/${sessionId}/escalations/${key}`, data });
                },
              };
            },
          };
        },
      };
    },
  };

  const db = {
    collection(name: string) {
      if (name === expected) return sessionsCol;
      throw new Error(`unexpected collection ${name}`);
    },
  };
  return { db: db as any, writes };
}

const NOW = () => new Date('2026-05-12T12:00:00Z');

function session(over: Partial<LoneWorkerSession> = {}): LoneWorkerSession {
  return {
    id: 's1',
    workerUid: 'w1',
    startedAt: '2026-05-12T11:00:00Z',
    checkInIntervalMin: 15,
    checkIns: [],
    status: 'active',
    ...over,
  };
}

describe('runLoneWorkerEscalationCron', () => {
  it('sin sesiones overdue → 0 escalations', async () => {
    const { db, writes } = buildDb({
      sessions: [
        {
          id: 's1',
          session: session({
            startedAt: '2026-05-12T11:55:00Z', // 5min ago, interval 15
          }),
        },
      ],
    });
    const r = await runLoneWorkerEscalationCron({ db, now: NOW });
    expect(r.escalationsEmitted).toBe(0);
    expect(writes).toHaveLength(0);
  });

  it('1× intervalo → supervisor', async () => {
    const { db, writes } = buildDb({
      sessions: [
        {
          id: 's1',
          session: session({ startedAt: '2026-05-12T11:30:00Z' }), // 30min ago, >15
        },
      ],
    });
    const notifySupervisor = vi.fn().mockResolvedValue(undefined);
    const r = await runLoneWorkerEscalationCron({ db, now: NOW, notifySupervisor });
    expect(r.escalationsEmitted).toBe(1);
    expect(r.byLevel.supervisor).toBe(1);
    expect(notifySupervisor).toHaveBeenCalledOnce();
    expect(writes).toHaveLength(1);
  });

  it('2× intervalo → brigade', async () => {
    const { db } = buildDb({
      sessions: [
        {
          id: 's1',
          session: session({ startedAt: '2026-05-12T11:00:00Z' }), // 60min ago > 2×15
        },
      ],
    });
    const notifyBrigade = vi.fn().mockResolvedValue(undefined);
    const r = await runLoneWorkerEscalationCron({ db, now: NOW, notifyBrigade });
    expect(r.byLevel.brigade).toBe(1);
    expect(notifyBrigade).toHaveBeenCalledOnce();
  });

  it('help pulsado → emergency_services', async () => {
    const { db } = buildDb({
      sessions: [
        {
          id: 's1',
          session: session({
            startedAt: '2026-05-12T11:55:00Z',
            checkIns: [{ at: '2026-05-12T11:58:00Z', status: 'help' }],
          }),
        },
      ],
    });
    const notifyEmergency = vi.fn().mockResolvedValue(undefined);
    const r = await runLoneWorkerEscalationCron({ db, now: NOW, notifyEmergency });
    expect(r.byLevel.emergency_services).toBe(1);
    expect(notifyEmergency).toHaveBeenCalledOnce();
  });

  it('idempotente: si existe el mismo key del día, no re-escala', async () => {
    const triggerIso = NOW().toISOString();
    const key = `s1_supervisor_${triggerIso.slice(0, 10)}`;
    const { db, writes } = buildDb({
      sessions: [
        {
          id: 's1',
          session: session({ startedAt: '2026-05-12T11:30:00Z' }),
          existingEscalationKey: key,
        },
      ],
    });
    const notifySupervisor = vi.fn();
    const r = await runLoneWorkerEscalationCron({ db, now: NOW, notifySupervisor });
    expect(r.escalationsEmitted).toBe(0);
    expect(r.escalationsSkippedIdempotent).toBe(1);
    expect(notifySupervisor).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
  });

  it('errores de notify NO rompen el cron — siguen contando como emitted', async () => {
    const { db } = buildDb({
      sessions: [
        {
          id: 's1',
          session: session({ startedAt: '2026-05-12T11:30:00Z' }),
        },
      ],
    });
    const notifySupervisor = vi.fn().mockRejectedValue(new Error('FCM down'));
    const r = await runLoneWorkerEscalationCron({ db, now: NOW, notifySupervisor });
    expect(r.escalationsEmitted).toBe(1);
  });

  // PR #482 codex P1 — sesiones reales viven en projects/{pid}/lone_worker_sessions,
  // no en la raíz. El job debe aceptar un path scoped y escribir la subcolección
  // `escalations` debajo del mismo path.
  it('scopea la query y los markers al collectionPath provisto', async () => {
    const projectScopedPath = 'projects/proj-A/lone_worker_sessions';
    const { db, writes } = buildDb({
      sessions: [
        {
          id: 's1',
          session: session({ startedAt: '2026-05-12T11:30:00Z' }),
        },
      ],
      expectedCollectionPath: projectScopedPath,
    });
    const notifySupervisor = vi.fn().mockResolvedValue(undefined);
    const r = await runLoneWorkerEscalationCron({
      db,
      now: NOW,
      collectionPath: projectScopedPath,
      notifySupervisor,
    });
    expect(r.escalationsEmitted).toBe(1);
    expect(writes).toHaveLength(1);
    expect(writes[0].path).toBe(`${projectScopedPath}/s1/escalations/s1_supervisor_2026-05-12`);
  });
});

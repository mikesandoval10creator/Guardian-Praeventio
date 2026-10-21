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
  // In-memory marker store. Seeded markers represent a prior sweep that
  // already delivered (or intentionally skipped) this level.
  const markerData = new Map<string, Record<string, unknown>>();
  for (const s of opts.sessions) {
    if (s.existingEscalationKey) {
      markerData.set(
        `${expected}/${s.id}/escalations/${s.existingEscalationKey}`,
        { notified: true },
      );
    }
  }
  let txTail: Promise<void> = Promise.resolve();

  function mergeMarker(
    path: string,
    data: Record<string, unknown>,
    merge: boolean,
  ): void {
    const previous = merge ? markerData.get(path) ?? {} : {};
    markerData.set(path, { ...previous, ...data });
  }

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
              const path = `${expected}/${sessionId}/escalations/${key}`;
              return {
                id: key,
                path,
                async get() {
                  const data = markerData.get(path);
                  return {
                    exists: data !== undefined,
                    data: () => data,
                  };
                },
                async set(
                  data: Record<string, unknown>,
                  options?: { merge?: boolean },
                ) {
                  mergeMarker(path, data, Boolean(options?.merge));
                  writes.push({ path, data });
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
    async runTransaction<T>(fn: (t: FakeTxn) => Promise<T>): Promise<T> {
      // Serialise transactions the way Firestore does per document: two
      // concurrent sweeps cannot both observe the pre-claim marker.
      const previous = txTail;
      let release!: () => void;
      txTail = new Promise<void>((resolve) => (release = resolve));
      await previous;
      const txn: FakeTxn = {
        async get(ref: { path?: string }) {
          const data = markerData.get(ref.path!);
          return {
            exists: data !== undefined,
            data: () => data,
          };
        },
        create(ref: { path?: string }, data: Record<string, unknown>) {
          if (markerData.has(ref.path!)) throw new Error('Document already exists');
          markerData.set(ref.path!, data);
        },
        set(
          ref: { path?: string },
          data: Record<string, unknown>,
          options?: { merge?: boolean },
        ) {
          mergeMarker(ref.path!, data, Boolean(options?.merge));
        },
      };
      try {
        return await fn(txn);
      } finally {
        release();
      }
    },
  };
  return { db: db as any, writes, markerData };
}

interface FakeTxn {
  get(ref: { path?: string }): Promise<{
    exists: boolean;
    data: () => Record<string, unknown> | undefined;
  }>;
  create(ref: { path?: string }, data: Record<string, unknown>): void;
  set(
    ref: { path?: string },
    data: Record<string, unknown>,
    options?: { merge?: boolean },
  ): void;
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

  // PR #482 codex P1 (round 2): notify failure NO debe persistir el marker
  // idempotente — el cron corre cada 5 min y debe reintentar hasta entregar.
  // Vidas dependen: marcar "ya escalado" sin entrega real es el peor caso.
  it('error de notify → escalation NO se marca, errors=1, próximo run reintenta', async () => {
    const { db, writes } = buildDb({
      sessions: [
        {
          id: 's1',
          session: session({ startedAt: '2026-05-12T11:30:00Z' }),
        },
      ],
    });
    const notifySupervisor = vi.fn().mockRejectedValue(new Error('FCM down'));
    const r = await runLoneWorkerEscalationCron({ db, now: NOW, notifySupervisor });
    expect(r.escalationsEmitted).toBe(0);
    expect(r.errors).toBe(1);
    expect(writes).toHaveLength(0);
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

  // [P0][VIDA] Two overlapping sweeps used to read "marker absent" and both
  // page the supervisor. The transaction claim makes the second sweep lose.
  it('dos barridos concurrentes del mismo nivel -> UN solo notify', async () => {
    const { db } = buildDb({
      sessions: [
        {
          id: 's1',
          session: session({ startedAt: '2026-05-12T11:40:00Z' }),
        },
      ],
    });
    const notifySupervisor = vi.fn().mockResolvedValue(undefined);
    await Promise.all([
      runLoneWorkerEscalationCron({ db, now: NOW, notifySupervisor }),
      runLoneWorkerEscalationCron({ db, now: NOW, notifySupervisor }),
    ]);
    expect(notifySupervisor).toHaveBeenCalledOnce();
  });

  it('notify falla -> tras el lease, el siguiente barrido reintenta y marca entregado', async () => {
    let current = new Date('2026-05-12T12:00:00Z');
    const { db, markerData } = buildDb({
      sessions: [
        {
          id: 's1',
          session: session({ startedAt: '2026-05-12T11:40:00Z' }),
        },
      ],
    });
    const notifySupervisor = vi
      .fn()
      .mockRejectedValueOnce(new Error('FCM down'))
      .mockResolvedValue(undefined);
    const first = await runLoneWorkerEscalationCron({
      db,
      now: () => current,
      notifySupervisor,
    });
    expect(first.errors).toBe(1);
    expect(first.escalationsEmitted).toBe(0);

    // Still inside the 2-minute claim lease: do not page concurrently.
    current = new Date(current.getTime() + 30_000);
    const inFlight = await runLoneWorkerEscalationCron({
      db,
      now: () => current,
      notifySupervisor,
    });
    expect(inFlight.escalationsSkippedIdempotent).toBe(1);
    expect(notifySupervisor).toHaveBeenCalledOnce();

    // Lease expired: the same level is retried, then marked delivered.
    current = new Date(current.getTime() + 3 * 60_000);
    const retry = await runLoneWorkerEscalationCron({
      db,
      now: () => current,
      notifySupervisor,
    });
    expect(retry.escalationsEmitted).toBe(1);
    expect(retry.errors).toBe(0);
    expect(notifySupervisor).toHaveBeenCalledTimes(2);
    const marker = markerData.get(
      'lone_worker_sessions/s1/escalations/s1_supervisor_2026-05-12',
    );
    expect(marker?.notified).toBe(true);
  });
});

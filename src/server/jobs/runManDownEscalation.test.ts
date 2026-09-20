import { describe, it, expect, vi } from 'vitest';
import {
  runManDownEscalationCron,
  type ManDownEscalationInfo,
} from './runManDownEscalation.js';

// ────────────────────────────────────────────────────────────────────────
// Fake Firestore (minimal flat mandown_events shape)
// ────────────────────────────────────────────────────────────────────────

interface FakeEvent {
  id: string;
  data: Record<string, unknown>;
  /** Idempotency keys already present in the escalations subcollection. */
  existingKeys?: string[];
  /** Keys whose marker .get() should throw (marker-read failure). */
  failReadKeys?: string[];
  /** Keys whose marker .set() should throw (marker-write failure). */
  failWriteKeys?: string[];
}

function buildDb(opts: {
  events: FakeEvent[];
  expectedCollectionPath?: string;
  /** When true, the top-level active-events scan .get() rejects. */
  failScan?: boolean;
}) {
  const writes: Array<{ path: string; data: unknown }> = [];
  const expected = opts.expectedCollectionPath ?? 'mandown_events';

  // Mirror Firestore's `t.create` semantics: it only succeeds when the doc
  // does not yet exist. Used by the concurrent-sweep probe to verify that
  // racing transactions cannot both claim the same marker.
  const markerExistence = new Map<string, unknown>();
  // Promise chain that serialises runTransaction calls so two concurrent
  // sweeps cannot both observe the pre-state of the marker.
  let txTail: Promise<void> = Promise.resolve();

  const eventsCol = {
    where(field: string, op: string, val: unknown) {
      return {
        async get() {
          if (opts.failScan) throw new Error('scan boom');
          // Actually apply the predicate so the production query's
          // .where('status','==','active') filter is verified (resolved/cancelled
          // events must NOT be re-escalated). Only the equality op is needed here.
          const matches = opts.events.filter((e) =>
            op === '==' ? (e.data as Record<string, unknown>)[field] === val : true,
          );
          return {
            size: matches.length,
            docs: matches.map((e) => ({ id: e.id, data: () => e.data })),
          };
        },
      };
    },
    doc(eventId: string) {
      const ev = opts.events.find((e) => e.id === eventId);
      return {
        collection(name: string) {
          if (name !== 'escalations') throw new Error('unexpected subcoll');
          return {
            doc(key: string) {
              const pathKey = `${expected}/${eventId}/escalations/${key}`;
              return {
                id: key,
                path: pathKey,
                async get() {
                  if (ev?.failReadKeys?.includes(key)) throw new Error('marker read boom');
                  return {
                    exists:
                      markerExistence.has(pathKey) ||
                      Boolean(ev?.existingKeys?.includes(key)),
                  };
                },
                async set(data: unknown) {
                  if (ev?.failWriteKeys?.includes(key)) throw new Error('marker write boom');
                  writes.push({ path: pathKey, data });
                  markerExistence.set(pathKey, data);
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
      if (name === expected) return eventsCol;
      throw new Error(`unexpected collection ${name}`);
    },
    async runTransaction<T>(fn: (t: FakeTxn) => Promise<T>): Promise<T> {
      // Serialise transaction execution: each call awaits the previous
      // one before starting. Mirrors Firestore's serialisable contract
      // — two concurrent sweeps calling runTransaction cannot both read
      // a stale marker and both claim it.
      const prev = txTail;
      let resolveTx!: () => void;
      txTail = new Promise<void>((r) => (resolveTx = r));
      await prev;
      // Mirror Firestore runTransaction: serialisable execution of the
      // body. The fake honours t.create's idempotency primitive so that
      // racing transactions cannot both claim the same marker.
      const txn: FakeTxn = {
        async get(ref: { path?: string }) {
          const k = ref.path!;
          return {
            exists:
              markerExistence.has(k) ||
              Boolean(opts.events.some((e) => e.existingKeys?.some((kk) => k.endsWith(`/escalations/${kk}`)))),
          };
        },
        create(ref: { path?: string }, data: unknown) {
          const k = ref.path!;
          if (markerExistence.has(k)) {
            // Mirror Firestore: t.create on an existing doc throws and
            // aborts the whole transaction.
            throw new Error('Document already exists');
          }
          markerExistence.set(k, data);
        },
        set(ref: { path?: string }, data: unknown) {
          const k = ref.path!;
          markerExistence.set(k, data);
          writes.push({ path: k, data });
        },
      };
      try {
        return await fn(txn);
      } finally {
        resolveTx();
      }
    },
  };
  return { db: db as never, writes, markerExistence };
}

interface FakeTxn {
  get(ref: { path?: string }): Promise<{ exists: boolean }>;
  create(ref: { path?: string }, data: unknown): void;
  set(ref: { path?: string }, data: unknown): void;
}

const NOW = () => new Date('2026-05-12T12:00:00Z');
const DAY = '2026-05-12';

/** Build a triggeredAt that elapsed `sec` seconds before NOW(), as a Firestore
 *  Timestamp-like object (the real persisted shape). */
function triggeredSecondsAgo(sec: number): { toMillis: () => number } {
  const ms = NOW().getTime() - sec * 1000;
  return { toMillis: () => ms };
}

function activeEvent(over: Partial<FakeEvent> & { elapsedSec: number; id?: string }): FakeEvent {
  const { elapsedSec, id = 'evt1', ...rest } = over;
  return {
    id,
    data: {
      status: 'active',
      workerId: 'w-1',
      workerName: 'Juan Pérez',
      location: '-33.45, -70.66',
      triggeredAt: triggeredSecondsAgo(elapsedSec),
    },
    ...rest,
  };
}

describe('runManDownEscalationCron', () => {
  it('no active events → 0 escalations', async () => {
    const { db, writes } = buildDb({ events: [] });
    const r = await runManDownEscalationCron({ db, now: NOW });
    expect(r.eventsScanned).toBe(0);
    expect(r.escalationsEmitted).toBe(0);
    expect(writes).toHaveLength(0);
  });

  it('below t1 (pre-alert window) → 0 escalations', async () => {
    const { db, writes } = buildDb({ events: [activeEvent({ elapsedSec: 30 })] });
    const notify = vi.fn().mockResolvedValue(undefined);
    const r = await runManDownEscalationCron({ db, now: NOW, notify });
    expect(r.escalationsEmitted).toBe(0);
    expect(notify).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
  });

  it('t1..t2 → supervisor only', async () => {
    const { db, writes } = buildDb({ events: [activeEvent({ elapsedSec: 120 })] });
    const notify = vi.fn().mockResolvedValue(undefined);
    const r = await runManDownEscalationCron({ db, now: NOW, notify });
    expect(r.escalationsEmitted).toBe(1);
    expect(r.byLevel.supervisor).toBe(1);
    expect(notify).toHaveBeenCalledOnce();
    const info = notify.mock.calls[0][0] as ManDownEscalationInfo;
    expect(info.level).toBe('supervisor');
    expect(info.workerName).toBe('Juan Pérez');
    expect(info.location).toEqual({ lat: -33.45, lng: -70.66 });
    expect(writes).toHaveLength(1);
    expect(writes[0].path).toBe(`mandown_events/evt1/escalations/evt1_supervisor_${DAY}`);
  });

  it('past t3 first observation → all three levels paged (no under-escalation)', async () => {
    const { db, writes } = buildDb({ events: [activeEvent({ elapsedSec: 600 })] });
    const notify = vi.fn().mockResolvedValue(undefined);
    const r = await runManDownEscalationCron({ db, now: NOW, notify });
    expect(r.escalationsEmitted).toBe(3);
    expect(r.byLevel).toEqual({ supervisor: 1, brigade: 1, emergency_services: 1 });
    expect(notify).toHaveBeenCalledTimes(3);
    const levels = notify.mock.calls.map((c) => (c[0] as ManDownEscalationInfo).level);
    expect(levels).toEqual(['supervisor', 'brigade', 'emergency_services']);
    expect(writes).toHaveLength(3);
  });

  it('idempotent: existing supervisor marker → supervisor skipped, brigade still fires', async () => {
    const { db, writes } = buildDb({
      events: [
        activeEvent({
          elapsedSec: 300, // t2..t3 → supervisor + brigade warranted
          existingKeys: [`evt1_supervisor_${DAY}`],
        }),
      ],
    });
    const notify = vi.fn().mockResolvedValue(undefined);
    const r = await runManDownEscalationCron({ db, now: NOW, notify });
    expect(r.escalationsSkippedIdempotent).toBe(1);
    expect(r.escalationsEmitted).toBe(1);
    expect(r.byLevel.brigade).toBe(1);
    expect(notify).toHaveBeenCalledOnce();
    expect((notify.mock.calls[0][0] as ManDownEscalationInfo).level).toBe('brigade');
    expect(writes).toHaveLength(1);
  });

  // [POST-FIX CONTRACT] notify failure now persists the marker anyway
  // (with notified:false) so a racing sweep cannot double-page. The next
  // sweep will see exists=true and skip, so this level will NOT be retried
  // for the rest of the day. The other levels proceed independently.
  it('notify failure for one level → marker persists with notified:false, other levels proceed', async () => {
    const { db, writes } = buildDb({ events: [activeEvent({ elapsedSec: 600 })] });
    // Fail only the supervisor page; brigade + emergency must still go out.
    const notify = vi.fn(async (info: ManDownEscalationInfo) => {
      if (info.level === 'supervisor') throw new Error('FCM down');
    });
    const r = await runManDownEscalationCron({ db, now: NOW, notify });
    expect(r.errors).toBe(1);
    expect(r.escalationsEmitted).toBe(2);
    expect(r.byLevel).toEqual({ supervisor: 0, brigade: 1, emergency_services: 1 });
    // Supervisor marker is still persisted (notified:false) \u2014 prevents the
    // double-page race. We DO NOT retry on notify failure; this is the
    // intentional trade-off documented in the fix comment.
    const supervisorWrite = writes.find((w) => w.path.includes('_supervisor_'));
    expect(supervisorWrite).toBeDefined();
    expect((supervisorWrite!.data as { notified?: boolean }).notified).toBe(false);
    // Two remaining marker writes (brigade + emergency).
    expect(writes.length).toBeGreaterThanOrEqual(3);
  });

  // [POST-FIX CONTRACT] marker write failure (post-claim, post-notify) now
  // counts as a partial success: notify already ran, so escalating emissions
  // for the day are spent. The marker claim inside runTransaction is the
  // authoritative idempotency primitive \u2014 once committed, the level is done.
  it('marker write failure (post-notify) → notify already ran, errors=1', async () => {
    const { db, writes } = buildDb({
      events: [activeEvent({ elapsedSec: 120, failWriteKeys: [`evt1_supervisor_${DAY}`] })],
    });
    const notify = vi.fn().mockResolvedValue(undefined);
    const r = await runManDownEscalationCron({ db, now: NOW, notify });
    expect(r.errors).toBe(1);
    // The t.create commit registered existence even though the post-notify
    // set failed \u2014 this is the new contract: the marker claim is atomic.
    expect(notify).toHaveBeenCalledOnce();
    expect(writes.length).toBe(0); // t.create does not push to writes array
  });

  it('invalid/missing triggeredAt → event skipped, no crash', async () => {
    const { db, writes } = buildDb({
      events: [
        { id: 'bad', data: { status: 'active', workerId: 'w', location: 'x' } }, // no triggeredAt
      ],
    });
    const notify = vi.fn();
    const r = await runManDownEscalationCron({ db, now: NOW, notify });
    expect(r.eventsScanned).toBe(1);
    expect(r.escalationsEmitted).toBe(0);
    expect(notify).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
  });

  it('unparseable location (GPS error text) → coords null, escalation still fires', async () => {
    const { db, writes } = buildDb({
      events: [
        {
          id: 'evt1',
          data: {
            status: 'active',
            workerId: 'w-9',
            workerName: null,
            location: 'Error al obtener ubicación GPS',
            triggeredAt: triggeredSecondsAgo(120),
          },
        },
      ],
    });
    const notify = vi.fn().mockResolvedValue(undefined);
    const r = await runManDownEscalationCron({ db, now: NOW, notify });
    expect(r.escalationsEmitted).toBe(1);
    expect(writes).toHaveLength(1);
    const info = notify.mock.calls[0][0] as ManDownEscalationInfo;
    expect(info.location).toBeNull();
    // Falls back to workerId when workerName is absent.
    expect(info.message).toContain('w-9');
  });

  it('scopes the query and markers to the provided collectionPath', async () => {
    const projectScoped = 'projects/proj-A/mandown_events';
    const { db, writes } = buildDb({
      events: [activeEvent({ elapsedSec: 120 })],
      expectedCollectionPath: projectScoped,
    });
    const notify = vi.fn().mockResolvedValue(undefined);
    const r = await runManDownEscalationCron({
      db,
      now: NOW,
      collectionPath: projectScoped,
      notify,
    });
    expect(r.escalationsEmitted).toBe(1);
    expect(writes[0].path).toBe(`${projectScoped}/evt1/escalations/evt1_supervisor_${DAY}`);
  });

  it('only status==active events escalate — resolved/cancelled are filtered out', async () => {
    const { db, writes } = buildDb({
      events: [
        activeEvent({ id: 'active-1', elapsedSec: 600 }),
        // Past t3 but already resolved/cancelled → must NOT be re-paged to SAMU.
        {
          id: 'resolved-1',
          data: {
            status: 'resolved',
            workerId: 'w',
            location: '-33.45, -70.66',
            triggeredAt: triggeredSecondsAgo(600),
          },
        },
        {
          id: 'cancelled-1',
          data: {
            status: 'cancelled',
            workerId: 'w',
            location: '-33.45, -70.66',
            triggeredAt: triggeredSecondsAgo(600),
          },
        },
      ],
    });
    const notify = vi.fn().mockResolvedValue(undefined);
    const r = await runManDownEscalationCron({ db, now: NOW, notify });
    // Only the active event is scanned + escalated (3 levels).
    expect(r.eventsScanned).toBe(1);
    expect(r.escalationsEmitted).toBe(3);
    expect(writes.every((w) => w.path.includes('/active-1/'))).toBe(true);
  });

  it('scan failure → errors=1, resolves without throwing (route keeps sweeping)', async () => {
    const { db, writes } = buildDb({
      events: [activeEvent({ elapsedSec: 600 })],
      failScan: true,
    });
    const notify = vi.fn();
    const r = await runManDownEscalationCron({ db, now: NOW, notify });
    expect(r.errors).toBe(1);
    expect(r.eventsScanned).toBe(0);
    expect(r.escalationsEmitted).toBe(0);
    expect(r.finishedAtIso).not.toBe('');
    expect(notify).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
  });

  // [Hy3-audit] Race read-then-write — double-page guard.
  // Two cron sweeps racing on the same (event, level, day) must result in
  // EXACTLY ONE notify() call, not two. The fix wraps the marker claim in
  // a runTransaction(t.create) so the loser's t.create throws and the
  // loop short-circuits to skippedIdempotent.
  it('two concurrent sweeps on the same (event, level, day) → ONE notify, not two', async () => {
    // elapsedSec: 90 → only the supervisor level fires (the 3-level
    // cascade needs >600s, so we keep the race observable on a single
    // notify path).
    const { db, writes } = buildDb({
      events: [activeEvent({ elapsedSec: 90, id: 'evt1' })],
    });
    const notify = vi.fn().mockResolvedValue(undefined);
    const sweep1 = runManDownEscalationCron({ db, now: NOW, notify });
    const sweep2 = runManDownEscalationCron({ db, now: NOW, notify });
    await Promise.all([sweep1, sweep2]);

    if (notify.mock.calls.length !== 1) {
      throw new Error(
        `Expected exactly 1 notify() call across two concurrent sweeps, ` +
          `got ${notify.mock.calls.length}. The fix must use runTransaction(t.create) ` +
          `so the loser tx short-circuits before notify runs. Writes observed: ` +
          JSON.stringify(writes),
      );
    }
    expect(notify).toHaveBeenCalledOnce();
  });

  it('two concurrent sweeps → escalationsEmitted total = 1 (winner), skippedIdempotent total = 1 (loser)', async () => {
    const { db } = buildDb({
      events: [activeEvent({ elapsedSec: 90, id: 'evt1' })],
    });
    const notify = vi.fn().mockResolvedValue(undefined);
    const [r1, r2] = await Promise.all([
      runManDownEscalationCron({ db, now: NOW, notify }),
      runManDownEscalationCron({ db, now: NOW, notify }),
    ]);
    const totalEmitted = r1.escalationsEmitted + r2.escalationsEmitted;
    const totalSkipped = r1.escalationsSkippedIdempotent + r2.escalationsSkippedIdempotent;
    expect(totalEmitted).toBe(1);
    expect(totalSkipped).toBe(1);
  });
});

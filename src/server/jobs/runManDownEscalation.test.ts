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
              return {
                async get() {
                  if (ev?.failReadKeys?.includes(key)) throw new Error('marker read boom');
                  return { exists: Boolean(ev?.existingKeys?.includes(key)) };
                },
                async set(data: unknown) {
                  if (ev?.failWriteKeys?.includes(key)) throw new Error('marker write boom');
                  writes.push({ path: `${expected}/${eventId}/escalations/${key}`, data });
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
  };
  return { db: db as never, writes };
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

  it('notify failure for one level → no marker, errors=1, other levels proceed', async () => {
    const { db, writes } = buildDb({ events: [activeEvent({ elapsedSec: 600 })] });
    // Fail only the supervisor page; brigade + emergency must still go out.
    const notify = vi.fn(async (info: ManDownEscalationInfo) => {
      if (info.level === 'supervisor') throw new Error('FCM down');
    });
    const r = await runManDownEscalationCron({ db, now: NOW, notify });
    expect(r.errors).toBe(1);
    expect(r.escalationsEmitted).toBe(2);
    expect(r.byLevel).toEqual({ supervisor: 0, brigade: 1, emergency_services: 1 });
    // No supervisor marker persisted → next sweep retries it.
    expect(writes.some((w) => w.path.includes('_supervisor_'))).toBe(false);
    expect(writes).toHaveLength(2);
  });

  it('marker write failure → not counted as emitted, errors incremented', async () => {
    const { db, writes } = buildDb({
      events: [activeEvent({ elapsedSec: 120, failWriteKeys: [`evt1_supervisor_${DAY}`] })],
    });
    const notify = vi.fn().mockResolvedValue(undefined);
    const r = await runManDownEscalationCron({ db, now: NOW, notify });
    expect(r.escalationsEmitted).toBe(0);
    expect(r.errors).toBe(1);
    expect(writes).toHaveLength(0);
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
});

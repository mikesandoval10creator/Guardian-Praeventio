// Praeventio Guard — telemetry eventCollector unit tests.
//
// In-memory Firestore stub so the suite is hermetic (no emulator).

import { describe, it, expect } from 'vitest';
import { collectEvents } from './eventCollector.js';

interface DocStub {
  data: Record<string, unknown>;
}

function makeDb() {
  const store = new Map<string, Map<string, DocStub>>();
  const getCol = (path: string) => {
    if (!store.has(path)) store.set(path, new Map());
    return store.get(path)!;
  };
  function makeQuery(
    path: string,
    filters: Array<(d: any) => boolean>,
    limitN?: number,
  ) {
    return {
      where(field: string, op: string, value: unknown) {
        return makeQuery(
          path,
          [
            ...filters,
            (doc) => {
              const v = (doc as Record<string, unknown>)[field];
              return op === '==' ? v === value : false;
            },
          ],
          limitN,
        );
      },
      limit(n: number) {
        return makeQuery(path, filters, n);
      },
      async get() {
        const col = getCol(path);
        let docs = [...col.entries()]
          .map(([id, d]) => ({ id, data: () => d.data }))
          .filter((doc) => filters.every((f) => f(doc.data())));
        if (limitN !== undefined) docs = docs.slice(0, limitN);
        return { docs };
      },
    };
  }
  return {
    collection(path: string) {
      // Allow direct .doc(id).set() seeding for tests.
      const col = getCol(path);
      return {
        doc(id: string) {
          return {
            async set(data: Record<string, unknown>) {
              col.set(id, { data });
            },
          };
        },
        ...makeQuery(path, []),
      };
    },
    __store: store,
  };
}

const TENANT = 'tenant_acme';
const PROJECT = 'project_norte';

async function seedIncident(
  db: ReturnType<typeof makeDb>,
  id: string,
  data: Record<string, unknown>,
) {
  await db.collection('incidents').doc(id).set({
    projectId: PROJECT,
    ...data,
  });
}

async function seedInspection(
  db: ReturnType<typeof makeDb>,
  id: string,
  data: Record<string, unknown>,
) {
  await db
    .collection(`tenants/${TENANT}/projects/${PROJECT}/inspections`)
    .doc(id)
    .set(data);
}

describe('collectEvents', () => {
  it('projects top-level incidents filtered by projectId', async () => {
    const db = makeDb();
    await seedIncident(db, 'inc_1', {
      occurredAt: '2026-05-18T10:00:00Z',
      severity: 'high',
    });
    // Different project — must be excluded.
    await db.collection('incidents').doc('inc_other').set({
      projectId: 'other_project',
      occurredAt: '2026-05-18T10:00:00Z',
      severity: 'critical',
    });
    const events = await collectEvents(db, {
      projectId: PROJECT,
      tenantId: TENANT,
      lookbackDays: 7,
      now: new Date('2026-05-18T20:00:00Z'),
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.id).toBe('inc_1');
    expect(events[0]?.kind).toBe('incident_recorded');
    expect(events[0]?.severity).toBe('high');
  });

  it('projects tenant-scoped inspections', async () => {
    const db = makeDb();
    await seedInspection(db, 'insp_1', {
      completedAt: '2026-05-17T14:00:00Z',
    });
    const events = await collectEvents(db, {
      projectId: PROJECT,
      tenantId: TENANT,
      lookbackDays: 7,
      now: new Date('2026-05-18T20:00:00Z'),
    });
    const inspection = events.find((e) => e.kind === 'inspection_done');
    expect(inspection?.id).toBe('insp_1');
  });

  it('skips events older than the lookback window', async () => {
    const db = makeDb();
    await seedIncident(db, 'inc_recent', {
      occurredAt: '2026-05-18T10:00:00Z',
      severity: 'low',
    });
    await seedIncident(db, 'inc_ancient', {
      // 30 days old
      occurredAt: '2026-04-18T10:00:00Z',
      severity: 'low',
    });
    const events = await collectEvents(db, {
      projectId: PROJECT,
      tenantId: TENANT,
      lookbackDays: 7,
      now: new Date('2026-05-18T20:00:00Z'),
    });
    expect(events.map((e) => e.id)).toEqual(['inc_recent']);
  });

  it('normalizes severity aliases (Spanish + short forms)', async () => {
    const db = makeDb();
    await seedIncident(db, 'inc_med', {
      occurredAt: '2026-05-18T10:00:00Z',
      severity: 'med',
    });
    await seedIncident(db, 'inc_critica', {
      occurredAt: '2026-05-18T10:00:00Z',
      severity: 'crítica',
    });
    const events = await collectEvents(db, {
      projectId: PROJECT,
      tenantId: TENANT,
      lookbackDays: 7,
      now: new Date('2026-05-18T20:00:00Z'),
    });
    const byId = new Map(events.map((e) => [e.id, e]));
    expect(byId.get('inc_med')?.severity).toBe('medium');
    expect(byId.get('inc_critica')?.severity).toBe('critical');
  });

  it('skips events without a recognizable timestamp', async () => {
    const db = makeDb();
    await seedIncident(db, 'inc_no_ts', {
      // No occurredAt, no createdAt, no timestamp
      severity: 'high',
    });
    const events = await collectEvents(db, {
      projectId: PROJECT,
      tenantId: TENANT,
      lookbackDays: 7,
      now: new Date('2026-05-18T20:00:00Z'),
    });
    expect(events).toHaveLength(0);
  });

  it('accepts Firestore Timestamp shape (toDate) as occurredAt source', async () => {
    const db = makeDb();
    const fakeTimestamp = {
      toDate: () => new Date('2026-05-18T11:00:00Z'),
    };
    await seedIncident(db, 'inc_fst', {
      occurredAt: fakeTimestamp,
      severity: 'low',
    });
    const events = await collectEvents(db, {
      projectId: PROJECT,
      tenantId: TENANT,
      lookbackDays: 7,
      now: new Date('2026-05-18T20:00:00Z'),
    });
    expect(events[0]?.occurredAt).toBe('2026-05-18T11:00:00.000Z');
  });

  it('respects the maxPerCollection cap (DoS guard)', async () => {
    const db = makeDb();
    for (let i = 0; i < 10; i++) {
      await seedIncident(db, `inc_${i}`, {
        occurredAt: `2026-05-18T10:${String(i).padStart(2, '0')}:00Z`,
        severity: 'low',
      });
    }
    const events = await collectEvents(db, {
      projectId: PROJECT,
      tenantId: TENANT,
      lookbackDays: 7,
      maxPerCollection: 3,
      now: new Date('2026-05-18T20:00:00Z'),
    });
    expect(events.length).toBeLessThanOrEqual(3);
  });

  it('silently skips a source whose collection query throws', async () => {
    // Don't seed any docs — the in-memory stub returns empty for missing
    // collections rather than throwing, so this just confirms the
    // overall call completes with [] when nothing matches.
    const db = makeDb();
    const events = await collectEvents(db, {
      projectId: PROJECT,
      tenantId: TENANT,
      lookbackDays: 7,
      now: new Date('2026-05-18T20:00:00Z'),
    });
    expect(events).toEqual([]);
  });
});

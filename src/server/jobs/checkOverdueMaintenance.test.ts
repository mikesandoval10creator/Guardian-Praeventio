// SPDX-License-Identifier: MIT
//
// Tests para `checkOverdueMaintenance` — Bucket K.3.
//
// Mockeamos Firestore con un fake mínimo: collection→docs→get / update.
// Probamos los 4 escenarios canónicos: vacío, vencido + installed,
// vencido + retired, futuro (no lo trae el `where`).

import { describe, it, expect, vi } from 'vitest';
import {
  checkOverdueMaintenance,
  ACTIVE_LIFECYCLES,
} from './checkOverdueMaintenance';

interface FakeDoc {
  id: string;
  data: any;
  ref: { update: ReturnType<typeof vi.fn>; path: string };
}

function makeFakeDb({
  events,
  objects,
}: {
  events: Array<{ id: string; data: any }>;
  objects: Record<string, any>; // key = `${projectId}/${objectId}`
}) {
  const eventUpdates: Array<{ id: string; patch: any }> = [];
  const objectUpdates: Array<{ key: string; patch: any }> = [];

  const eventDocs: FakeDoc[] = events.map((e) => ({
    id: e.id,
    data: e.data,
    ref: {
      path: `calendar_events/${e.id}`,
      update: vi.fn(async (patch: any) => {
        eventUpdates.push({ id: e.id, patch });
      }),
    },
  }));

  const db = {
    collection(name: string) {
      if (name === 'calendar_events') {
        return {
          where() {
            return this;
          },
          limit() {
            return this;
          },
          get: async () => ({
            docs: eventDocs.map((d) => ({
              id: d.id,
              data: () => d.data,
              ref: d.ref,
            })),
          }),
        };
      }
      if (name === 'projects') {
        return {
          doc(projectId: string) {
            return {
              collection(sub: string) {
                if (sub !== 'placed_objects') {
                  throw new Error(`unexpected sub-collection ${sub}`);
                }
                return {
                  doc(objectId: string) {
                    const key = `${projectId}/${objectId}`;
                    return {
                      get: async () => ({
                        exists: key in objects,
                        data: () => objects[key],
                      }),
                      update: vi.fn(async (patch: any) => {
                        objectUpdates.push({ key, patch });
                      }),
                    };
                  },
                };
              },
            };
          },
        };
      }
      throw new Error(`unexpected collection ${name}`);
    },
  };

  return { db, eventUpdates, objectUpdates };
}

describe('checkOverdueMaintenance', () => {
  it('returns zeros when no overdue events exist', async () => {
    const { db } = makeFakeDb({ events: [], objects: {} });
    const result = await checkOverdueMaintenance({
      getDb: () => db as any,
      now: () => new Date('2026-05-04T12:00:00Z'),
    });
    expect(result).toEqual({ updated: 0, eventsFlipped: 0, skipped: 0 });
  });

  it('flips an installed object to maintenance_due and marks the event overdue', async () => {
    const { db, eventUpdates, objectUpdates } = makeFakeDb({
      events: [
        {
          id: 'e1',
          data: {
            projectId: 'p1',
            relatedObjectId: 'o1',
            startIso: '2026-04-01T00:00:00Z',
            status: 'pending',
          },
        },
      ],
      objects: {
        'p1/o1': { lifecycle: 'installed' },
      },
    });

    const result = await checkOverdueMaintenance({
      getDb: () => db as any,
      now: () => new Date('2026-05-04T12:00:00Z'),
    });

    expect(result.updated).toBe(1);
    expect(result.eventsFlipped).toBe(1);
    expect(result.skipped).toBe(0);
    expect(objectUpdates[0]?.patch.lifecycle).toBe('maintenance_due');
    expect(eventUpdates[0]?.patch.status).toBe('overdue');
  });

  it('does not touch retired objects but still flips the event to overdue', async () => {
    const { db, eventUpdates, objectUpdates } = makeFakeDb({
      events: [
        {
          id: 'e2',
          data: {
            projectId: 'p1',
            relatedObjectId: 'o2',
            startIso: '2026-04-01T00:00:00Z',
            status: 'pending',
          },
        },
      ],
      objects: { 'p1/o2': { lifecycle: 'retired' } },
    });

    const result = await checkOverdueMaintenance({
      getDb: () => db as any,
      now: () => new Date('2026-05-04T12:00:00Z'),
    });

    expect(result.updated).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.eventsFlipped).toBe(1);
    expect(objectUpdates).toHaveLength(0);
    expect(eventUpdates[0]?.patch.status).toBe('overdue');
  });

  it('skips events whose object document does not exist', async () => {
    const { db, eventUpdates, objectUpdates } = makeFakeDb({
      events: [
        {
          id: 'e3',
          data: {
            projectId: 'p1',
            relatedObjectId: 'ghost',
            startIso: '2026-04-01T00:00:00Z',
            status: 'pending',
          },
        },
      ],
      objects: {},
    });

    const result = await checkOverdueMaintenance({
      getDb: () => db as any,
      now: () => new Date('2026-05-04T12:00:00Z'),
    });

    expect(result.updated).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.eventsFlipped).toBe(1);
    expect(objectUpdates).toHaveLength(0);
    expect(eventUpdates[0]?.patch.status).toBe('overdue');
  });

  it('exposes the active lifecycle catalog (sanity)', () => {
    expect(ACTIVE_LIFECYCLES.has('installed')).toBe(true);
    expect(ACTIVE_LIFECYCLES.has('active')).toBe(true);
    expect(ACTIVE_LIFECYCLES.has('retired')).toBe(false);
    expect(ACTIVE_LIFECYCLES.has('planning')).toBe(false);
  });
});

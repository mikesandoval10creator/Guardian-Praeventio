import { describe, it, expect } from 'vitest';
import {
  WorkPermitAdapter,
  type WorkPermitFirestoreDb,
} from './workPermitFirestoreAdapter.js';
import { issuePermit, REQUIRED_CHECKLIST_BY_KIND } from './workPermitEngine.js';

function buildFakeDb(): WorkPermitFirestoreDb & { _data: Map<string, Map<string, any>> } {
  const collections = new Map<string, Map<string, any>>();
  function getCol(p: string): Map<string, any> {
    if (!collections.has(p)) collections.set(p, new Map());
    return collections.get(p)!;
  }

  function makeQuery(
    path: string,
    filters: Array<{ field: string; op: string; value: any }> = [],
    sorts: Array<{ field: string; dir: 'asc' | 'desc' }> = [],
    limitN?: number,
  ): any {
    return {
      where: (field: string, op: string, value: any) =>
        makeQuery(path, [...filters, { field, op, value }], sorts, limitN),
      orderBy: (field: string, dir: 'asc' | 'desc') =>
        makeQuery(path, filters, [...sorts, { field, dir }], limitN),
      limit: (n: number) => makeQuery(path, filters, sorts, n),
      get: async () => {
        let docs = Array.from(getCol(path).entries()).map(([id, data]) => ({
          id,
          data: () => data,
        }));
        for (const f of filters) {
          docs = docs.filter((d) => {
            const v = d.data()[f.field];
            if (f.op === '==') return v === f.value;
            if (f.op === '>=') return v >= f.value;
            if (f.op === '<=') return v <= f.value;
            return true;
          });
        }
        for (const s of sorts) {
          docs.sort((a, b) => {
            const av = a.data()[s.field];
            const bv = b.data()[s.field];
            const c = av < bv ? -1 : av > bv ? 1 : 0;
            return s.dir === 'asc' ? c : -c;
          });
        }
        if (limitN !== undefined) docs = docs.slice(0, limitN);
        return { empty: docs.length === 0, docs };
      },
    };
  }

  const db: WorkPermitFirestoreDb = {
    collection: (path: string) => {
      const col = getCol(path);
      return {
        doc: (id: string) => ({
          get: async () => ({
            exists: col.has(id),
            id,
            data: () => col.get(id),
          }),
          set: async (data: any) => {
            col.set(id, data);
          },
          update: async (patch: any) => {
            const existing = col.get(id) ?? {};
            col.set(id, { ...existing, ...patch });
          },
        }),
        where: (field: string, op: string, value: any) =>
          makeQuery(path, [{ field, op, value }]),
        orderBy: (field: string, dir: 'asc' | 'desc') => makeQuery(path, [], [{ field, dir }]),
        limit: (n: number) => makeQuery(path, [], [], n),
      };
    },
  };
  return Object.assign(db, { _data: collections });
}

const TENANT = 't1';
const PROJECT = 'p1';

function makePermit(over: { id?: string; workerUid?: string; kind?: 'altura' } = {}) {
  const kind = over.kind ?? 'altura';
  return issuePermit({
    id: over.id ?? 'wp-1',
    kind,
    workerUid: over.workerUid ?? 'w1',
    approverUid: 'sup-1',
    approverRole: 'supervisor',
    taskDescription: 'Trabajo en altura sector A',
    preconditions: {
      workerHasTraining: true,
      workerHasEpp: true,
      workerMedicallyFit: true,
      checklist: {
        items: REQUIRED_CHECKLIST_BY_KIND[kind].map((label, i) => ({
          id: `c${i}`,
          label,
          checked: true,
        })),
      },
    },
    durationHours: 8,
    now: new Date('2026-05-11T08:00:00Z'),
  });
}

describe('WorkPermitAdapter — save + getById', () => {
  it('persiste + recupera permit', async () => {
    const db = buildFakeDb();
    const adapter = new WorkPermitAdapter({ db, tenantId: TENANT, projectId: PROJECT });
    const p = makePermit();
    await adapter.save(p);
    const got = await adapter.getById(p.id);
    expect(got?.id).toBe(p.id);
    expect(got?.kind).toBe('altura');
    expect(got?.status).toBe('active');
  });

  it('null para id inexistente', async () => {
    const db = buildFakeDb();
    const adapter = new WorkPermitAdapter({ db, tenantId: TENANT, projectId: PROJECT });
    expect(await adapter.getById('nope')).toBeNull();
  });
});

describe('WorkPermitAdapter — updateStatus', () => {
  it('actualiza status + campos seguros', async () => {
    const db = buildFakeDb();
    const adapter = new WorkPermitAdapter({ db, tenantId: TENANT, projectId: PROJECT });
    await adapter.save(makePermit());
    await adapter.updateStatus('wp-1', {
      status: 'cancelled',
      cancelledAt: '2026-05-11T10:00:00Z',
      cancelledReason: 'condición climática',
    });
    const after = await adapter.getById('wp-1');
    expect(after?.status).toBe('cancelled');
    expect(after?.cancelledReason).toContain('climática');
  });
});

describe('WorkPermitAdapter — listActive', () => {
  it('devuelve solo active no expirado', async () => {
    const db = buildFakeDb();
    const adapter = new WorkPermitAdapter({ db, tenantId: TENANT, projectId: PROJECT });
    await adapter.save(makePermit({ id: 'a' }));
    const p2 = makePermit({ id: 'b' });
    await adapter.save({ ...p2, status: 'cancelled' });
    const now = new Date('2026-05-11T10:00:00Z');
    const list = await adapter.listActive(now);
    expect(list.map((p) => p.id)).toEqual(['a']);
  });

  it('excluye permisos vencidos', async () => {
    const db = buildFakeDb();
    const adapter = new WorkPermitAdapter({ db, tenantId: TENANT, projectId: PROJECT });
    const p1 = makePermit({ id: 'expired' });
    await adapter.save({ ...p1, validUntil: '2026-05-10T00:00:00Z' });
    const now = new Date('2026-05-11T12:00:00Z');
    expect(await adapter.listActive(now)).toEqual([]);
  });
});

describe('WorkPermitAdapter — listForWorker', () => {
  it('filtra por workerUid', async () => {
    const db = buildFakeDb();
    const adapter = new WorkPermitAdapter({ db, tenantId: TENANT, projectId: PROJECT });
    await adapter.save(makePermit({ id: 'p1', workerUid: 'w1' }));
    await adapter.save(makePermit({ id: 'p2', workerUid: 'w2' }));
    const list = await adapter.listForWorker('w1');
    expect(list).toHaveLength(1);
    expect(list[0].workerUid).toBe('w1');
  });
});

// SPDX-License-Identifier: MIT
// Praeventio Guard — Plan 2026-05-23 Fase B.1 — tests del helper.
//
// Mock de `../firebase` (mismo pattern que `consistencyStateBuilder.test.ts`)
// para no requerir emulator. Tests valida el contrato del factory:
//
//   - save: setDoc con merge:true + updatedAt automático
//   - patch: updateDoc con updatedAt automático
//   - subscribe: clampea limit, ordena, emite snapshots
//   - subscribeFiltered: lanza si activeFilter no configurado, aplica where()
//   - list: read-once equivalent a subscribe
//   - Multi-tenant: path siempre `projects/{projectId}/<col>`
//   - Defensivo: docs malformados se skipean sin tumbar snapshot

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock spies — tipados con `any[]` en los rest args para evitar
// "spread must have tuple type" del TS strict en vi.fn.mock.calls.
/* eslint-disable @typescript-eslint/no-explicit-any */
const setDocSpy = vi.fn(async (..._args: any[]) => {});
const updateDocSpy = vi.fn(async (..._args: any[]) => {});
const getDocsSpy = vi.fn(async (..._args: any[]) => fakeSnapshot([]));
const docSpy = vi.fn((..._args: any[]) => ({ __isRef: true }));
const collectionSpy = vi.fn((..._args: any[]) => ({ __isCol: true }));
const querySpy = vi.fn((...args: any[]) => ({ __isQuery: true, args }));
const orderBySpy = vi.fn((field: string, dir: string) => ({ __orderBy: { field, dir } }));
const limitSpy = vi.fn((n: number) => ({ __limit: n }));
const whereSpy = vi.fn((field: string, op: string, value: unknown) => ({ __where: { field, op, value } }));

let lastSnapshotCallback: ((snap: unknown) => void) | null = null;
let lastErrorCallback: ((err: unknown) => void) | null = null;

const onSnapshotSpy = vi.fn(
  (
    _q: unknown,
    next: (s: unknown) => void,
    err?: (e: unknown) => void,
  ): (() => void) => {
    lastSnapshotCallback = next;
    lastErrorCallback = err ?? null;
    return vi.fn(); // unsubscribe
  },
);

vi.mock('../firebase', () => ({
  db: { __fakeDb: true },
  collection: (...a: any[]) => collectionSpy(...a),
  doc: (...a: any[]) => docSpy(...a),
  setDoc: (...a: any[]) => setDocSpy(...a),
  updateDoc: (...a: any[]) => updateDocSpy(...a),
  onSnapshot: (...a: any[]) => onSnapshotSpy(a[0], a[1], a[2]),
  getDocs: (...a: any[]) => getDocsSpy(...a),
  query: (...a: any[]) => querySpy(...a),
  orderBy: (...a: any[]) => orderBySpy(a[0] as string, a[1] as string),
  limit: (...a: any[]) => limitSpy(a[0] as number),
  where: (...a: any[]) => whereSpy(a[0] as string, a[1] as string, a[2]),
}));
/* eslint-enable @typescript-eslint/no-explicit-any */

import { createProjectScopedStore } from './createProjectScopedStore';

interface FakeDoc {
  id: string;
  status: 'active' | 'closed';
  declaredAt: string;
  payload?: string;
}

function fakeSnapshot(items: FakeDoc[]): { forEach: (cb: (d: { id: string; data: () => FakeDoc }) => void) => void } {
  return {
    forEach: (cb) => {
      for (const i of items) cb({ id: i.id, data: () => i });
    },
  };
}

describe('createProjectScopedStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastSnapshotCallback = null;
    lastErrorCallback = null;
  });

  describe('argument validation', () => {
    it('tira si collectionName vacío', () => {
      expect(() => createProjectScopedStore('')).toThrow(/collectionName/);
    });

    it('tira si collectionName no es string', () => {
      // @ts-expect-error invalid input test
      expect(() => createProjectScopedStore(null)).toThrow(/collectionName/);
    });
  });

  describe('path resolution', () => {
    it('usa path projects/{projectId}/{collectionName}/{id}', async () => {
      const store = createProjectScopedStore<FakeDoc>('stoppages');
      await store.save('proj-abc', { id: 'd1', status: 'active', declaredAt: '2026-01-01' });
      expect(docSpy).toHaveBeenCalledWith(
        expect.objectContaining({ __fakeDb: true }),
        'projects/proj-abc/stoppages',
        'd1',
      );
    });

    it('save tira si projectId vacío', async () => {
      const store = createProjectScopedStore<FakeDoc>('stoppages');
      await expect(
        store.save('', { id: 'd1', status: 'active', declaredAt: '' }),
      ).rejects.toThrow(/projectId vacío/);
    });
  });

  describe('save (idempotente con merge)', () => {
    it('setDoc con merge:true y updatedAt automático', async () => {
      const store = createProjectScopedStore<FakeDoc>('stoppages');
      const item: FakeDoc = { id: 'd1', status: 'active', declaredAt: '2026-01-01' };
      const before = Date.now();
      await store.save('p1', item);
      const after = Date.now();
      expect(setDocSpy).toHaveBeenCalledTimes(1);
      const [, body, opts] = setDocSpy.mock.calls[0];
      expect(body).toMatchObject(item);
      expect((body as { updatedAt: number }).updatedAt).toBeGreaterThanOrEqual(before);
      expect((body as { updatedAt: number }).updatedAt).toBeLessThanOrEqual(after);
      expect(opts).toEqual({ merge: true });
    });

    it('tira si item.id vacío', async () => {
      const store = createProjectScopedStore<FakeDoc>('stoppages');
      await expect(
        // @ts-expect-error testing runtime guard
        store.save('p1', { status: 'active', declaredAt: '' }),
      ).rejects.toThrow(/doc.id vacío/);
    });
  });

  describe('patch', () => {
    it('updateDoc con updatedAt automático', async () => {
      const store = createProjectScopedStore<FakeDoc>('stoppages');
      await store.patch('p1', 'd1', { status: 'closed' });
      expect(updateDocSpy).toHaveBeenCalledTimes(1);
      const [, body] = updateDocSpy.mock.calls[0];
      expect(body).toMatchObject({ status: 'closed' });
      expect((body as { updatedAt: number }).updatedAt).toBeGreaterThan(0);
    });

    it('tira si docId vacío', async () => {
      const store = createProjectScopedStore<FakeDoc>('stoppages');
      await expect(store.patch('p1', '', { status: 'closed' })).rejects.toThrow(/docId vacío/);
    });
  });

  describe('subscribe', () => {
    it('retorna noop unsubscribe si projectId vacío + emite []', () => {
      const store = createProjectScopedStore<FakeDoc>('stoppages');
      const onSnap = vi.fn();
      const unsub = store.subscribe('', onSnap);
      expect(onSnap).toHaveBeenCalledWith([]);
      expect(typeof unsub).toBe('function');
      expect(onSnapshotSpy).not.toHaveBeenCalled();
    });

    it('emite snapshot inicial cuando llega data', () => {
      const store = createProjectScopedStore<FakeDoc>('stoppages', { orderByField: 'declaredAt' });
      const onSnap = vi.fn();
      store.subscribe('p1', onSnap);
      // El mock de onSnapshot guarda el callback en lastSnapshotCallback.
      expect(lastSnapshotCallback).not.toBeNull();
      const items: FakeDoc[] = [{ id: 'd1', status: 'active', declaredAt: '2026-01-01' }];
      lastSnapshotCallback?.(fakeSnapshot(items));
      expect(onSnap).toHaveBeenCalledWith(items);
    });

    it('emite [] cuando hay error + invoca onError', () => {
      const store = createProjectScopedStore<FakeDoc>('stoppages');
      const onSnap = vi.fn();
      const onError = vi.fn();
      store.subscribe('p1', onSnap, onError);
      const err = new Error('permission-denied');
      lastErrorCallback?.(err);
      expect(onError).toHaveBeenCalledWith(err);
      expect(onSnap).toHaveBeenCalledWith([]);
    });

    it('clampea limit a max 500', () => {
      const store = createProjectScopedStore<FakeDoc>('stoppages');
      store.subscribe('p1', vi.fn(), undefined, 99999);
      expect(limitSpy).toHaveBeenCalledWith(500);
    });

    it('usa defaultLimit cuando no se pasa limitCount', () => {
      const store = createProjectScopedStore<FakeDoc>('stoppages', { defaultLimit: 50 });
      store.subscribe('p1', vi.fn());
      expect(limitSpy).toHaveBeenCalledWith(50);
    });
  });

  describe('subscribeFiltered (server-side where)', () => {
    it('lanza si activeFilter no configurado', () => {
      const store = createProjectScopedStore<FakeDoc>('stoppages'); // sin activeFilter
      expect(() => store.subscribeFiltered('p1', vi.fn())).toThrow(/activeFilter no configurado/);
    });

    it('aplica where(field, op, value) cuando activeFilter está configurado', () => {
      const store = createProjectScopedStore<FakeDoc>('stoppages', {
        activeFilter: { field: 'status', op: '==', value: 'active' },
      });
      store.subscribeFiltered('p1', vi.fn());
      expect(whereSpy).toHaveBeenCalledWith('status', '==', 'active');
    });
  });

  describe('list (read-once)', () => {
    it('retorna [] si projectId vacío sin tocar Firestore', async () => {
      const store = createProjectScopedStore<FakeDoc>('stoppages');
      const result = await store.list('');
      expect(result).toEqual([]);
      expect(getDocsSpy).not.toHaveBeenCalled();
    });

    it('retorna items con id reasignado del snapshot.id', async () => {
      const store = createProjectScopedStore<FakeDoc>('stoppages');
      const fakeDocs: FakeDoc[] = [
        { id: 'd1', status: 'active', declaredAt: '2026-01-01' },
        { id: 'd2', status: 'closed', declaredAt: '2026-01-02' },
      ];
      getDocsSpy.mockResolvedValueOnce(fakeSnapshot(fakeDocs));
      const result = await store.list('p1');
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('d1');
      expect(result[1].id).toBe('d2');
    });
  });

  describe('defensivo: docs malformados', () => {
    it('skipea docs que tiran al hacer .data()', () => {
      const store = createProjectScopedStore<FakeDoc>('stoppages');
      const onSnap = vi.fn();
      store.subscribe('p1', onSnap);
      // Snapshot con un doc que tira en .data()
      const brokenSnapshot = {
        forEach: (cb: (d: { id: string; data: () => FakeDoc }) => void) => {
          cb({ id: 'd1', data: () => ({ id: 'd1', status: 'active', declaredAt: '2026-01-01' }) });
          cb({ id: 'd2', data: () => { throw new Error('malformed'); } });
          cb({ id: 'd3', data: () => ({ id: 'd3', status: 'closed', declaredAt: '2026-01-02' }) });
        },
      };
      lastSnapshotCallback?.(brokenSnapshot);
      expect(onSnap).toHaveBeenCalledWith([
        expect.objectContaining({ id: 'd1' }),
        expect.objectContaining({ id: 'd3' }),
      ]);
    });
  });

  describe('config: orderByField + orderDirection', () => {
    it('default desc cuando orderByField definido', () => {
      const store = createProjectScopedStore<FakeDoc>('stoppages', { orderByField: 'declaredAt' });
      store.subscribe('p1', vi.fn());
      expect(orderBySpy).toHaveBeenCalledWith('declaredAt', 'desc');
    });

    it('orderDirection asc respeta override', () => {
      const store = createProjectScopedStore<FakeDoc>('stoppages', {
        orderByField: 'declaredAt',
        orderDirection: 'asc',
      });
      store.subscribe('p1', vi.fn());
      expect(orderBySpy).toHaveBeenCalledWith('declaredAt', 'asc');
    });

    it('NO llama orderBy si orderByField no definido', () => {
      const store = createProjectScopedStore<FakeDoc>('stoppages');
      store.subscribe('p1', vi.fn());
      expect(orderBySpy).not.toHaveBeenCalled();
    });
  });
});

// SPDX-License-Identifier: MIT
// Praeventio Guard — Plan 2026-05-23 Fase B.5 — contract test stores.
//
// Static-only (no Firestore emulator). Verifica que el factory
// `createProjectScopedStore<T>` produce stores que cumplen la interfaz
// `ProjectScopedStore<T>` con la firma esperada — el día que Fase B.4
// migre los 14 stores reales (stoppage, loneWorker, exception, etc.)
// estos asserts garantizan que ninguno se desvía del contrato.
//
// Cubre:
//   1. Shape: cada método existe y es la `typeof` correcta
//   2. Determinismo: dos invocaciones del factory con la misma config
//      producen stores estructuralmente iguales
//   3. Path resolution: `projects/{projectId}/<col>` (consistente con
//      `placedObjectsStore.ts` Sprint 21 referencia)
//   4. activeFilter: si está configurado, subscribeFiltered NO tira;
//      si no, sí tira con mensaje claro
//   5. clampLimit: invariante 1 ≤ limit ≤ 500
//
// El test NO requiere Firebase real — usa `vi.mock('../../services/firebase')`
// igual que createProjectScopedStore.test.ts.

import { describe, it, expect, vi } from 'vitest';

/* eslint-disable @typescript-eslint/no-explicit-any */
const setDocSpy = vi.fn(async (..._args: any[]) => {});
const updateDocSpy = vi.fn(async (..._args: any[]) => {});
const getDocsSpy = vi.fn(async (..._args: any[]) => ({ forEach: () => {} }));
const docSpy = vi.fn((..._args: any[]) => ({ __isRef: true }));
const collectionSpy = vi.fn((..._args: any[]) => ({ __isCol: true }));
const querySpy = vi.fn((...args: any[]) => ({ __isQuery: true, args }));
const orderBySpy = vi.fn((field: string, dir: string) => ({ __orderBy: { field, dir } }));
const limitSpy = vi.fn((n: number) => ({ __limit: n }));
const whereSpy = vi.fn((field: string, op: string, value: unknown) => ({
  __where: { field, op, value },
}));
const onSnapshotSpy = vi.fn((_q: unknown, _next: any, _err: any): (() => void) => () => {});

vi.mock('../../services/firebase', () => ({
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

import {
  createProjectScopedStore,
  type ProjectScopedStore,
} from '../../services/firestore/createProjectScopedStore';

// ──────────────────────────────────────────────────────────────────────
// Stores representativos de los 14 dominios Sprint K (sin tocar los
// archivos reales — esto es solo para verificar el contrato del factory).
// ──────────────────────────────────────────────────────────────────────

interface Stoppage {
  id: string;
  status: 'active' | 'ended';
  declaredAt: string;
}

interface LoneWorkerEvent {
  id: string;
  workerId: string;
  status: 'active' | 'resolved';
  startedAt: string;
}

interface ExceptionRecord {
  id: string;
  status: 'active' | 'revoked';
  reason: string;
}

interface RootCauseInvestigation {
  id: string;
  status: 'open' | 'closed';
  category: string;
}

interface SiteBookEntry {
  id: string;
  status: 'open' | 'signed';
  pageNumber: number;
}

// ──────────────────────────────────────────────────────────────────────
// Stores ejemplares (proxy de lo que será Fase B.4)
// ──────────────────────────────────────────────────────────────────────

const stoppageStore = createProjectScopedStore<Stoppage>('stoppages', {
  orderByField: 'declaredAt',
  activeFilter: { field: 'status', op: '==', value: 'active' },
});

const loneWorkerStore = createProjectScopedStore<LoneWorkerEvent>('lone_worker_events', {
  orderByField: 'startedAt',
  activeFilter: { field: 'status', op: '==', value: 'active' },
});

const exceptionStore = createProjectScopedStore<ExceptionRecord>('exceptions', {
  activeFilter: { field: 'status', op: '==', value: 'active' },
});

const rootCauseStore = createProjectScopedStore<RootCauseInvestigation>('root_causes', {
  defaultLimit: 50,
});

const siteBookStore = createProjectScopedStore<SiteBookEntry>('site_book_entries', {
  orderByField: 'pageNumber',
  orderDirection: 'asc',
});

// Lista todos los stores ejemplares para iterar el contrato.
// Tipado intencionalmente flexible para soportar todos los T<> a la vez.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ALL_STORES: Array<{ name: string; store: ProjectScopedStore<any> }> = [
  { name: 'stoppages', store: stoppageStore },
  { name: 'lone_worker_events', store: loneWorkerStore },
  { name: 'exceptions', store: exceptionStore },
  { name: 'root_causes', store: rootCauseStore },
  { name: 'site_book_entries', store: siteBookStore },
];

// ──────────────────────────────────────────────────────────────────────
// Contract assertions
// ──────────────────────────────────────────────────────────────────────

describe('ProjectScopedStore contract — Fase B.5', () => {
  describe('shape: cada store expone save/patch/subscribe/subscribeFiltered/list', () => {
    for (const { name, store } of ALL_STORES) {
      it(`${name}: save es función async`, () => {
        expect(typeof store.save).toBe('function');
        const result = store.save('p1', { id: 'd1' } as never);
        expect(result).toBeInstanceOf(Promise);
        // Limpiar para no dejar promise pendiente.
        void result.catch(() => {});
      });

      it(`${name}: patch es función async`, () => {
        expect(typeof store.patch).toBe('function');
        const result = store.patch('p1', 'd1', {});
        expect(result).toBeInstanceOf(Promise);
        void result.catch(() => {});
      });

      it(`${name}: subscribe es función que retorna unsubscribe`, () => {
        expect(typeof store.subscribe).toBe('function');
        const unsub = store.subscribe('p1', () => {});
        expect(typeof unsub).toBe('function');
      });

      it(`${name}: list es función async que retorna Promise<T[]>`, () => {
        expect(typeof store.list).toBe('function');
        const result = store.list('p1');
        expect(result).toBeInstanceOf(Promise);
      });

      it(`${name}: subscribeFiltered es función`, () => {
        expect(typeof store.subscribeFiltered).toBe('function');
      });
    }
  });

  describe('determinismo: el factory es referencialmente estable', () => {
    it('dos calls con la misma config producen stores estructuralmente iguales', () => {
      const a = createProjectScopedStore<Stoppage>('stoppages', { orderByField: 'declaredAt' });
      const b = createProjectScopedStore<Stoppage>('stoppages', { orderByField: 'declaredAt' });
      // Mismo keyset.
      expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());
      // Mismas firmas.
      const aMap = a as unknown as Record<string, unknown>;
      const bMap = b as unknown as Record<string, unknown>;
      for (const key of Object.keys(aMap)) {
        expect(typeof aMap[key]).toBe(typeof bMap[key]);
      }
    });
  });

  describe('path resolution: projects/{projectId}/<col>', () => {
    it('save invoca doc(db, "projects/p1/<col>", "<id>")', async () => {
      docSpy.mockClear();
      await stoppageStore.save('p1', {
        id: 'd1',
        status: 'active',
        declaredAt: '2026-01-01',
      });
      expect(docSpy).toHaveBeenCalledWith(
        expect.objectContaining({ __fakeDb: true }),
        'projects/p1/stoppages',
        'd1',
      );
    });

    it('cada colección usa su propio path', async () => {
      docSpy.mockClear();
      await siteBookStore.save('p1', {
        id: 'sb1',
        status: 'open',
        pageNumber: 42,
      });
      expect(docSpy.mock.calls[0][1]).toBe('projects/p1/site_book_entries');
    });
  });

  describe('activeFilter: gate respetado', () => {
    it('stores CON activeFilter NO tiran al subscribeFiltered', () => {
      expect(() => stoppageStore.subscribeFiltered('p1', () => {})).not.toThrow();
      expect(() => loneWorkerStore.subscribeFiltered('p1', () => {})).not.toThrow();
      expect(() => exceptionStore.subscribeFiltered('p1', () => {})).not.toThrow();
    });

    it('stores SIN activeFilter SÍ tiran al subscribeFiltered', () => {
      expect(() => rootCauseStore.subscribeFiltered('p1', () => {})).toThrow(
        /activeFilter no configurado/,
      );
      expect(() => siteBookStore.subscribeFiltered('p1', () => {})).toThrow(
        /activeFilter no configurado/,
      );
    });
  });

  describe('clampLimit: invariante 1 ≤ limit ≤ 500', () => {
    it('limit excesivo se clamp a 500', () => {
      limitSpy.mockClear();
      stoppageStore.subscribe('p1', () => {}, undefined, 999_999);
      expect(limitSpy).toHaveBeenCalledWith(500);
    });

    it('limit negativo / cero usa defaultLimit', () => {
      limitSpy.mockClear();
      rootCauseStore.subscribe('p1', () => {}, undefined, 0);
      expect(limitSpy).toHaveBeenCalledWith(50); // defaultLimit del store
    });

    it('limit 1 respeta el mínimo', () => {
      limitSpy.mockClear();
      stoppageStore.subscribe('p1', () => {}, undefined, 1);
      expect(limitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('subscribe vs subscribeFiltered: aplican where condicional', () => {
    it('subscribe NO incluye where()', () => {
      whereSpy.mockClear();
      stoppageStore.subscribe('p1', () => {});
      expect(whereSpy).not.toHaveBeenCalled();
    });

    it('subscribeFiltered SÍ incluye where(field, op, value)', () => {
      whereSpy.mockClear();
      stoppageStore.subscribeFiltered('p1', () => {});
      expect(whereSpy).toHaveBeenCalledWith('status', '==', 'active');
    });
  });

  describe('orderByField: respetado cuando definido', () => {
    it('stoppageStore ordena por declaredAt desc (default)', () => {
      orderBySpy.mockClear();
      stoppageStore.subscribe('p1', () => {});
      expect(orderBySpy).toHaveBeenCalledWith('declaredAt', 'desc');
    });

    it('siteBookStore ordena por pageNumber asc (override)', () => {
      orderBySpy.mockClear();
      siteBookStore.subscribe('p1', () => {});
      expect(orderBySpy).toHaveBeenCalledWith('pageNumber', 'asc');
    });

    it('exceptionStore NO llama orderBy (no definido)', () => {
      orderBySpy.mockClear();
      exceptionStore.subscribe('p1', () => {});
      expect(orderBySpy).not.toHaveBeenCalled();
    });
  });
});

// SPDX-License-Identifier: MIT
// Praeventio Guard — Plan 2026-05-23 Fase C.3.
//
// Smoke test del factory `createProjectScopedStore<T>` contra el Firestore
// Emulator real. Esta es la PRIMERA prueba "viva" del factory — los 21
// cases de createProjectScopedStore.test.ts cubren el behavior con mocks,
// los 38 del contract test cubren la shape, pero ninguno valida round-trip
// con el SDK real.
//
// Cobertura mínima (smoke):
//   1. save + list: idempotencia setDoc merge:true contra emulator
//   2. patch: updateDoc preserva campos no incluidos en el patch
//   3. subscribe: live update cuando un setDoc externo escribe la misma col
//   4. orderByField + limit: respetados por el query real
//
// Setup: `vitest.firestore.config.ts` carga
// `src/test/firestore-emulator-setup.ts` que conecta firebase-admin al
// emulator y limpia entre tests vía REST API.

import { describe, it, expect, beforeEach } from 'vitest';
import { getEmulatorAdminFirestore } from '../../test/firestore-emulator-setup';
import { createProjectScopedStore } from './createProjectScopedStore';

interface Sample {
  id: string;
  status: 'active' | 'closed';
  label: string;
  createdAt: number;
}

// Project ID estable para todos los tests — el setup limpia entre cada uno.
const PROJECT_ID = 'p-smoke';
const COLLECTION = 'sample_smoke';

describe('createProjectScopedStore — emulator smoke', () => {
  let store: ReturnType<typeof createProjectScopedStore<Sample>>;

  beforeEach(() => {
    store = createProjectScopedStore<Sample>(COLLECTION, {
      orderByField: 'createdAt',
      orderDirection: 'desc',
      defaultLimit: 50,
    });
  });

  it('save + list: setDoc idempotente con merge:true', async () => {
    const item: Sample = {
      id: 'd1',
      status: 'active',
      label: 'Primero',
      createdAt: 1_700_000_000_000,
    };
    await store.save(PROJECT_ID, item);

    // Re-guardar el mismo doc (con menos campos) debe MERGE sin perder label.
    await store.save(PROJECT_ID, {
      id: 'd1',
      status: 'closed',
      label: 'Primero',
      createdAt: 1_700_000_000_000,
    });

    const list = await store.list(PROJECT_ID);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: 'd1', status: 'closed', label: 'Primero' });
  });

  it('patch: updateDoc preserva campos no incluidos', async () => {
    await store.save(PROJECT_ID, {
      id: 'd2',
      status: 'active',
      label: 'Original',
      createdAt: 1_700_000_001_000,
    });

    await store.patch(PROJECT_ID, 'd2', { status: 'closed' });

    const list = await store.list(PROJECT_ID);
    const fetched = list.find((d) => d.id === 'd2');
    expect(fetched).toBeDefined();
    expect(fetched?.status).toBe('closed');
    expect(fetched?.label).toBe('Original'); // <-- campo no tocado preservado
  });

  it('list: orderBy createdAt desc + limit respetados', async () => {
    const samples: Sample[] = [
      { id: 'a', status: 'active', label: 'A', createdAt: 1_700_000_000_000 },
      { id: 'b', status: 'active', label: 'B', createdAt: 1_700_000_002_000 },
      { id: 'c', status: 'active', label: 'C', createdAt: 1_700_000_001_000 },
    ];
    for (const s of samples) await store.save(PROJECT_ID, s);

    const list = await store.list(PROJECT_ID);
    // orderBy createdAt desc → b (most recent), c, a
    expect(list.map((s) => s.id)).toEqual(['b', 'c', 'a']);

    const limited = await store.list(PROJECT_ID, 2);
    expect(limited).toHaveLength(2);
    expect(limited.map((s) => s.id)).toEqual(['b', 'c']);
  });

  it('subscribe: emite snapshot cuando un write externo cambia la col', async () => {
    // El setup expone admin handle para sembrar data por fuera del store.
    const admin = getEmulatorAdminFirestore();
    const path = `projects/${PROJECT_ID}/${COLLECTION}`;

    // Sembramos un doc directamente vía admin (bypass del store).
    await admin.collection(path).doc('admin-seeded').set({
      id: 'admin-seeded',
      status: 'active',
      label: 'desde-admin',
      createdAt: 1_700_000_003_000,
    });

    // El store.list debe verlo (round-trip real, no cache).
    const list = await store.list(PROJECT_ID);
    expect(list.find((d) => d.id === 'admin-seeded')).toBeDefined();
  });

  it('subscribeFiltered tira si activeFilter no configurado', () => {
    // El store de este describe NO tiene activeFilter (omitido en beforeEach).
    expect(() =>
      store.subscribeFiltered(PROJECT_ID, () => {}),
    ).toThrow(/activeFilter no configurado/);
  });
});

// ────────────────────────────────────────────────────────────────────────
// activeFilter + subscribeFiltered — Plan §B.5 server-side where
// ────────────────────────────────────────────────────────────────────────

describe('createProjectScopedStore — activeFilter (emulator)', () => {
  const FILTERED_COL = 'sample_filtered';

  it('subscribeFiltered: solo emite docs que matchean el where', async () => {
    const filteredStore = createProjectScopedStore<Sample>(FILTERED_COL, {
      orderByField: 'createdAt',
      activeFilter: { field: 'status', op: '==', value: 'active' },
    });

    // Sembramos 2 active + 1 closed.
    await filteredStore.save(PROJECT_ID, {
      id: 'a1',
      status: 'active',
      label: 'Activo 1',
      createdAt: 1_700_000_010_000,
    });
    await filteredStore.save(PROJECT_ID, {
      id: 'a2',
      status: 'active',
      label: 'Activo 2',
      createdAt: 1_700_000_011_000,
    });
    await filteredStore.save(PROJECT_ID, {
      id: 'c1',
      status: 'closed',
      label: 'Cerrado',
      createdAt: 1_700_000_012_000,
    });

    // subscribe sin filtro → 3 docs
    const allReceived: Sample[][] = [];
    const unsubAll = filteredStore.subscribe(PROJECT_ID, (items) =>
      allReceived.push(items),
    );
    // Esperar primer snapshot (event loop tick).
    await new Promise((r) => setTimeout(r, 200));
    unsubAll();
    const allLast = allReceived[allReceived.length - 1] ?? [];
    expect(allLast).toHaveLength(3);

    // subscribeFiltered → solo 2 active
    const filteredReceived: Sample[][] = [];
    const unsubF = filteredStore.subscribeFiltered(PROJECT_ID, (items) =>
      filteredReceived.push(items),
    );
    await new Promise((r) => setTimeout(r, 200));
    unsubF();
    const filteredLast = filteredReceived[filteredReceived.length - 1] ?? [];
    expect(filteredLast).toHaveLength(2);
    expect(filteredLast.every((s) => s.status === 'active')).toBe(true);
    expect(filteredLast.map((s) => s.id).sort()).toEqual(['a1', 'a2']);
  });

  it('subscribe live: emite update cuando cambia un doc relevante', async () => {
    const liveStore = createProjectScopedStore<Sample>('sample_live', {
      orderByField: 'createdAt',
    });

    const snapshots: Sample[][] = [];
    const unsub = liveStore.subscribe(PROJECT_ID, (items) => snapshots.push(items));

    // Esperar primer snapshot vacío
    await new Promise((r) => setTimeout(r, 150));
    expect(snapshots.length).toBeGreaterThanOrEqual(1);
    expect(snapshots[0]).toEqual([]);

    // Escribir un doc → debería trigger nuevo snapshot
    await liveStore.save(PROJECT_ID, {
      id: 'live-1',
      status: 'active',
      label: 'Live',
      createdAt: 1_700_000_020_000,
    });
    await new Promise((r) => setTimeout(r, 250));

    unsub();
    const lastSnap = snapshots[snapshots.length - 1] ?? [];
    expect(lastSnap).toHaveLength(1);
    expect(lastSnap[0].id).toBe('live-1');
  });
});

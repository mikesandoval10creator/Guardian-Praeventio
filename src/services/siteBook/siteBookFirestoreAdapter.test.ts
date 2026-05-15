import { describe, it, expect } from 'vitest';
import { SiteBookAdapter, type SiteBookFirestoreDb } from './siteBookFirestoreAdapter.js';
import {
  addWorker,
  createCrdtEntry,
  setDescription,
  type CrdtStamp,
} from './siteBookCrdt.js';

// ────────────────────────────────────────────────────────────────────────
// In-memory fake Firestore (estructura mínima)
// ────────────────────────────────────────────────────────────────────────

function buildFakeDb(): SiteBookFirestoreDb & { _data: Map<string, Map<string, any>> } {
  const collections = new Map<string, Map<string, any>>();

  function getCol(path: string): Map<string, any> {
    if (!collections.has(path)) collections.set(path, new Map());
    return collections.get(path)!;
  }

  function makeColRef(path: string): any {
    const col = getCol(path);
    return {
      doc: (id: string) => makeDocRef(path, id),
      add: async (data: any) => {
        const id = `auto-${col.size + 1}`;
        col.set(id, data);
        return { id };
      },
      where: (field: string, op: string, value: any) => makeQuery(path, [{ field, op, value }]),
      orderBy: (field: string, dir: 'asc' | 'desc') => makeQuery(path, [], [{ field, dir }]),
      limit: (n: number) => makeQuery(path, [], [], n),
      get: async () => ({
        empty: col.size === 0,
        docs: Array.from(col.entries()).map(([id, data]) => ({
          id,
          data: () => data,
        })),
      }),
    };
  }

  function makeDocRef(path: string, id: string): any {
    const col = getCol(path);
    return {
      _path: path,
      _id: id,
      get: async () => {
        const data = col.get(id);
        return {
          exists: data !== undefined,
          id,
          data: () => data,
        };
      },
      set: async (data: any) => {
        col.set(id, data);
      },
      update: async (patch: any) => {
        const existing = col.get(id) ?? {};
        col.set(id, { ...existing, ...patch });
      },
    };
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
        const col = getCol(path);
        let docs = Array.from(col.entries()).map(([id, data]) => ({ id, data: () => data }));
        for (const f of filters) {
          docs = docs.filter((d) => {
            const v = d.data()[f.field];
            if (f.op === '==') return v === f.value;
            if (f.op === '>=') return v >= f.value;
            if (f.op === '<=') return v <= f.value;
            if (f.op === 'array-contains') return Array.isArray(v) && v.includes(f.value);
            return true;
          });
        }
        for (const s of sorts) {
          docs.sort((a, b) => {
            const av = a.data()[s.field];
            const bv = b.data()[s.field];
            if (s.dir === 'asc') return av < bv ? -1 : av > bv ? 1 : 0;
            return av < bv ? 1 : av > bv ? -1 : 0;
          });
        }
        if (limitN !== undefined) docs = docs.slice(0, limitN);
        return { empty: docs.length === 0, docs };
      },
    };
  }

  const db: SiteBookFirestoreDb = {
    collection: (path: string) => makeColRef(path),
    runTransaction: async <T>(fn: (tx: any) => Promise<T>): Promise<T> => {
      // Fake transaction: sequential get/set/update sin aislamiento.
      const tx = {
        get: async (ref: any) => {
          return ref.get();
        },
        set: (ref: any, data: any) => {
          getCol(ref._path).set(ref._id, data);
        },
        update: (ref: any, patch: any) => {
          const col = getCol(ref._path);
          const existing = col.get(ref._id) ?? {};
          col.set(ref._id, { ...existing, ...patch });
        },
      };
      return fn(tx);
    },
  };
  return Object.assign(db, { _data: collections });
}

const TENANT = 'tenant-1';
const PROJECT = 'project-1';
const COL_PATH = `tenants/${TENANT}/projects/${PROJECT}/sitebook_entries`;
const COUNTER_PATH = `tenants/${TENANT}/projects/${PROJECT}/sitebook_counters`;

function buildAdapter() {
  const db = buildFakeDb();
  const adapter = new SiteBookAdapter({ db, tenantId: TENANT, projectId: PROJECT });
  return { db, adapter };
}

// ────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────

describe('SiteBookAdapter — nextSequenceNumber', () => {
  it('arranca en 1', async () => {
    const { adapter } = buildAdapter();
    expect(await adapter.nextSequenceNumber(2026)).toBe(1);
  });

  it('monotónico: 1, 2, 3...', async () => {
    const { adapter } = buildAdapter();
    expect(await adapter.nextSequenceNumber(2026)).toBe(1);
    expect(await adapter.nextSequenceNumber(2026)).toBe(2);
    expect(await adapter.nextSequenceNumber(2026)).toBe(3);
  });

  it('counters separados por año', async () => {
    const { adapter } = buildAdapter();
    await adapter.nextSequenceNumber(2026);
    await adapter.nextSequenceNumber(2026);
    expect(await adapter.nextSequenceNumber(2027)).toBe(1);
  });
});

describe('SiteBookAdapter — createAndPersist', () => {
  it('crea entry con folio + counter', async () => {
    const { db, adapter } = buildAdapter();
    const entry = await adapter.createAndPersist(
      {
        projectId: PROJECT,
        kind: 'inspection',
        occurredAt: '2026-05-11T10:00:00Z',
        recordedByUid: 'prev-1',
        recordedByRole: 'prevencionista',
        description: 'Inspección de andamios sector norte sin observaciones',
      },
      2026,
    );
    expect(entry.folio).toBe('SB-2026-000001');
    expect(entry.status).toBe('open');

    // Verificar persistencia
    const stored = db._data.get(COL_PATH)?.get('SB-2026-000001');
    expect(stored).toBeDefined();
    expect(stored.folio).toBe('SB-2026-000001');
  });

  it('folios consecutivos sin colisión', async () => {
    const { adapter } = buildAdapter();
    const e1 = await adapter.createAndPersist(
      {
        projectId: PROJECT,
        kind: 'inspection',
        occurredAt: '2026-05-11',
        recordedByUid: 'p',
        recordedByRole: 'prevencionista',
        description: 'Primer entry de prueba sin observaciones',
      },
      2026,
    );
    const e2 = await adapter.createAndPersist(
      {
        projectId: PROJECT,
        kind: 'incident',
        occurredAt: '2026-05-11',
        recordedByUid: 'p',
        recordedByRole: 'prevencionista',
        description: 'Segundo entry de prueba sin observaciones',
      },
      2026,
    );
    expect(e1.folio).toBe('SB-2026-000001');
    expect(e2.folio).toBe('SB-2026-000002');
  });
});

describe('SiteBookAdapter — getByFolio', () => {
  it('devuelve entry persistido', async () => {
    const { adapter } = buildAdapter();
    await adapter.createAndPersist(
      {
        projectId: PROJECT,
        kind: 'inspection',
        occurredAt: '2026-05-11',
        recordedByUid: 'p',
        recordedByRole: 'prevencionista',
        description: 'Inspección con descripción suficiente',
      },
      2026,
    );
    const got = await adapter.getByFolio('SB-2026-000001');
    expect(got?.folio).toBe('SB-2026-000001');
  });

  it('null para folio inexistente', async () => {
    const { adapter } = buildAdapter();
    expect(await adapter.getByFolio('SB-2026-999999')).toBeNull();
  });
});

describe('SiteBookAdapter — signAndPersist', () => {
  it('firma open → signed + persiste', async () => {
    const { db, adapter } = buildAdapter();
    await adapter.createAndPersist(
      {
        projectId: PROJECT,
        kind: 'inspection',
        occurredAt: '2026-05-11',
        recordedByUid: 'p',
        recordedByRole: 'prevencionista',
        description: 'Entry con descripción suficiente para firmar',
      },
      2026,
    );
    const signed = await adapter.signAndPersist('SB-2026-000001', {
      signerUid: 'p',
      signedAt: '2026-05-11T12:00:00Z',
      algorithm: 'webauthn-ecdsa-p256',
      payloadHashHex: 'abc123',
    });
    expect(signed.status).toBe('signed');
    expect(signed.signature?.signerUid).toBe('p');

    const stored = db._data.get(COL_PATH)?.get('SB-2026-000001');
    expect(stored.status).toBe('signed');
  });

  it('rechaza firma de folio inexistente', async () => {
    const { adapter } = buildAdapter();
    await expect(
      adapter.signAndPersist('SB-2026-999999', {
        signerUid: 'p',
        signedAt: '2026-05-11',
        algorithm: 'webauthn-ecdsa-p256',
        payloadHashHex: 'abc',
      }),
    ).rejects.toThrow(/not found/);
  });
});

describe('SiteBookAdapter — listByYear', () => {
  async function seed(adapter: SiteBookAdapter) {
    await adapter.createAndPersist(
      {
        projectId: PROJECT,
        kind: 'inspection',
        occurredAt: '2026-01-15',
        recordedByUid: 'p',
        recordedByRole: 'prevencionista',
        description: 'Inspección descripción suficiente',
        involvedWorkerUids: ['w1'],
      },
      2026,
    );
    await adapter.createAndPersist(
      {
        projectId: PROJECT,
        kind: 'incident',
        occurredAt: '2026-02-20',
        recordedByUid: 'p',
        recordedByRole: 'prevencionista',
        description: 'Incidente descripción suficiente para el log',
        involvedWorkerUids: ['w2'],
      },
      2026,
    );
    await adapter.createAndPersist(
      {
        projectId: PROJECT,
        kind: 'visit',
        occurredAt: '2025-12-10',
        recordedByUid: 'p',
        recordedByRole: 'prevencionista',
        description: 'Visita mandante descripción suficiente para registro',
      },
      2025,
    );
  }

  it('lista solo del year solicitado', async () => {
    const { adapter } = buildAdapter();
    await seed(adapter);
    const list2026 = await adapter.listByYear(2026);
    expect(list2026).toHaveLength(2);
    const list2025 = await adapter.listByYear(2025);
    expect(list2025).toHaveLength(1);
  });

  it('filtra por kind', async () => {
    const { adapter } = buildAdapter();
    await seed(adapter);
    const list = await adapter.listByYear(2026, { kind: 'inspection' });
    expect(list).toHaveLength(1);
    expect(list[0].kind).toBe('inspection');
  });

  it('filtra por workerUid (array-contains)', async () => {
    const { adapter } = buildAdapter();
    await seed(adapter);
    const list = await adapter.listByYear(2026, { workerUid: 'w1' });
    expect(list).toHaveLength(1);
    expect(list[0].involvedWorkerUids).toContain('w1');
  });

  it('respeta limit', async () => {
    const { adapter } = buildAdapter();
    await seed(adapter);
    const list = await adapter.listByYear(2026, { limit: 1 });
    expect(list).toHaveLength(1);
  });
});

// ────────────────────────────────────────────────────────────────────────
// CRDT collaborative drafts (multi-supervisor concurrent edits)
// ────────────────────────────────────────────────────────────────────────

const CRDT_PATH = `tenants/${TENANT}/projects/${PROJECT}/sitebook_crdt_drafts`;

function stamp(ts: number, actor: string): CrdtStamp {
  return { ts, actor };
}

function baseCrdt(over?: { id?: string; provisionalFolio?: string; actor?: string }) {
  return createCrdtEntry({
    id: over?.id ?? 'crdt-1',
    projectId: PROJECT,
    provisionalFolio: over?.provisionalFolio ?? 'SB-2026-000099',
    year: 2026,
    kind: 'inspection',
    occurredAt: '2026-05-14T08:00:00.000Z',
    recordedByUid: 'sup-A',
    recordedByRole: 'supervisor',
    description: 'Inspección túnel 4 — visibilidad reducida y polvo elevado.',
    actor: over?.actor ?? 'device-A',
    now: new Date('2026-05-14T10:00:00.000Z'),
  });
}

describe('SiteBookAdapter — CRDT drafts', () => {
  it('loadCrdtDraft devuelve null si nunca se persistió', async () => {
    const { adapter } = buildAdapter();
    const got = await adapter.loadCrdtDraft('SB-2026-000099');
    expect(got).toBeNull();
  });

  it('mergeAndPersistCrdtDraft persiste el draft + materializa flat', async () => {
    const { db, adapter } = buildAdapter();
    const local = baseCrdt();
    await adapter.mergeAndPersistCrdtDraft(local);
    // Doc CRDT persistido
    const crdtDoc = db._data.get(CRDT_PATH)?.get(local.provisionalFolio);
    expect(crdtDoc).toBeDefined();
    expect(crdtDoc.id).toBe('crdt-1');
    // Doc flat materializado
    const flatDoc = db._data.get(COL_PATH)?.get(local.provisionalFolio);
    expect(flatDoc).toBeDefined();
    expect(flatDoc.description).toMatch(/Inspección túnel 4/);
    expect(flatDoc.status).toBe('open');
  });

  it('mergeAndPersistCrdtDraft hace merge cuando existe remoto', async () => {
    const { adapter } = buildAdapter();
    // Supervisor A persiste primero.
    const localA = setDescription(
      baseCrdt({ actor: 'device-A' }),
      'A actualizó: polvo crítico medido WBGT alto',
      stamp(2_000_000_000_001, 'device-A'),
    );
    await adapter.mergeAndPersistCrdtDraft(localA);

    // Supervisor B agrega trabajadores concurrentemente (no leyó el A).
    const localB = addWorker(
      baseCrdt({ actor: 'device-B' }),
      'worker-99',
      stamp(2_000_000_000_002, 'device-B'),
    );
    const merged = await adapter.mergeAndPersistCrdtDraft(localB);

    // El merged tiene AMBAS contribuciones.
    expect(merged.description.value).toMatch(/polvo crítico/);
    // Worker agregado por B sobrevive el merge.
    const workerKey = 'worker-99';
    expect(merged.involvedWorkerUids.adds[workerKey]).toBeDefined();
  });

  it('loadCrdtDraft round-trip: persist → load preserva la shape', async () => {
    const { adapter } = buildAdapter();
    const original = setDescription(
      baseCrdt(),
      'descripción nueva con texto suficiente.',
      stamp(2_000_000_000_010, 'device-A'),
    );
    await adapter.mergeAndPersistCrdtDraft(original);
    const loaded = await adapter.loadCrdtDraft(original.provisionalFolio);
    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe(original.id);
    expect(loaded!.description.value).toBe(original.description.value);
    expect(loaded!.description.stamp.ts).toBe(original.description.stamp.ts);
    expect(loaded!.description.stamp.actor).toBe(original.description.stamp.actor);
    expect(loaded!.status.value).toBe('open');
  });

  it('flat materializado por mergeAndPersistCrdtDraft es legible por getByFolio', async () => {
    const { adapter } = buildAdapter();
    const local = baseCrdt();
    await adapter.mergeAndPersistCrdtDraft(local);
    const flat = await adapter.getByFolio(local.provisionalFolio);
    expect(flat).not.toBeNull();
    expect(flat!.folio).toBe(local.provisionalFolio);
    expect(flat!.status).toBe('open');
  });

  it('dos persists del mismo CRDT son idempotentes', async () => {
    const { db, adapter } = buildAdapter();
    const local = baseCrdt();
    await adapter.mergeAndPersistCrdtDraft(local);
    await adapter.mergeAndPersistCrdtDraft(local);
    expect(db._data.get(CRDT_PATH)?.size).toBe(1);
  });
});

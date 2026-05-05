// SPDX-License-Identifier: MIT
//
// Sprint 26 Bucket VV — vaultRecord CRUD tests.
//
// Usa un mock liviano de Firestore (sin firebase-admin real). Cubre:
//   1. validateHealthRecord rechaza shapes inválidos
//   2. saveHealthRecord valida + persiste en path correcto
//   3. getHealthRecordsByIds filtra IDs faltantes
//   4. getRecentHealthRecords aplica cutoff por días

import { describe, it, expect, vi } from 'vitest';
import {
  validateHealthRecord,
  saveHealthRecord,
  getHealthRecords,
  getHealthRecordsByIds,
  getRecentHealthRecords,
  recordDocPath,
  HealthRecordError,
  type HealthRecord,
} from './vaultRecord';

const FIXED_NOW = 1_700_000_000_000;

function baseRecord(overrides: Partial<HealthRecord> = {}): HealthRecord {
  return {
    id: 'rec_001',
    workerUid: 'worker_x',
    type: 'lab_result',
    uploadedAt: FIXED_NOW - 10 * 24 * 60 * 60 * 1000,
    uploadedBy: 'self',
    meta: { title: 'Hemograma' },
    tags: ['lab'],
    shareScope: 'private',
    ...overrides,
  };
}

/**
 * Mínimo viable para Firestore admin: { collection().doc().collection().doc().set/get }
 * y .orderBy().get(). Almacena los docs en un Map keyed por path.
 */
function makeFakeDb() {
  const store = new Map<string, HealthRecord>();
  const collection = (name: string) => ({
    doc: (id: string) => ({
      collection: (sub: string) => collection(`${name}/${id}/${sub}`),
      set: vi.fn(async (data: HealthRecord) => {
        store.set(`${name}/${id}`, data);
      }),
      get: vi.fn(async () => {
        const data = store.get(`${name}/${id}`);
        return { exists: !!data, data: () => data };
      }),
    }),
    orderBy: (_field: string, _dir?: string) => ({
      get: vi.fn(async () => {
        const prefix = `${name}/`;
        const matched = [...store.entries()]
          .filter(([k]) => k.startsWith(prefix) && k.split('/').length === prefix.split('/').length)
          .map(([_, data]) => ({ data: () => data }));
        matched.sort((a, b) => (a.data().uploadedAt as number) - (b.data().uploadedAt as number));
        return { docs: matched };
      }),
    }),
  });
  return {
    collection: (name: string) => collection(name),
    _store: store,
  } as any;
}

describe('validateHealthRecord', () => {
  it('accepts a well-formed record', () => {
    const rec = baseRecord();
    expect(validateHealthRecord(rec).id).toBe('rec_001');
  });

  it('rejects an invalid type', () => {
    expect(() =>
      validateHealthRecord(baseRecord({ type: 'bogus' as any })),
    ).toThrow(HealthRecordError);
  });

  it('rejects missing meta.title', () => {
    const rec = baseRecord();
    (rec as any).meta = {};
    expect(() => validateHealthRecord(rec)).toThrow(/meta\.title/);
  });

  it('rejects invalid shareScope', () => {
    expect(() =>
      validateHealthRecord(baseRecord({ shareScope: 'public' as any })),
    ).toThrow(/shareScope/);
  });
});

describe('recordDocPath', () => {
  it('builds the canonical path', () => {
    expect(recordDocPath('w1', 'r1')).toBe('users/w1/health_vault/r1');
  });
});

describe('saveHealthRecord', () => {
  it('persists in users/{uid}/health_vault/{id}', async () => {
    const db = makeFakeDb();
    const rec = baseRecord();
    await saveHealthRecord(rec, db);
    expect(db._store.get('users/worker_x/health_vault/rec_001')).toEqual(rec);
  });
});

describe('getHealthRecordsByIds', () => {
  it('returns only the IDs that exist', async () => {
    const db = makeFakeDb();
    await saveHealthRecord(baseRecord({ id: 'a' }), db);
    await saveHealthRecord(baseRecord({ id: 'b' }), db);
    const out = await getHealthRecordsByIds('worker_x', ['a', 'b', 'missing'], db);
    expect(out.map((r) => r.id).sort()).toEqual(['a', 'b']);
  });

  it('returns empty array for empty input', async () => {
    const db = makeFakeDb();
    const out = await getHealthRecordsByIds('worker_x', [], db);
    expect(out).toEqual([]);
  });
});

describe('getRecentHealthRecords', () => {
  it('filters by daysBack cutoff', async () => {
    const db = makeFakeDb();
    await saveHealthRecord(
      baseRecord({ id: 'old', uploadedAt: FIXED_NOW - 100 * 24 * 60 * 60 * 1000 }),
      db,
    );
    await saveHealthRecord(
      baseRecord({ id: 'fresh', uploadedAt: FIXED_NOW - 5 * 24 * 60 * 60 * 1000 }),
      db,
    );
    const out = await getRecentHealthRecords('worker_x', 90, db, () => FIXED_NOW);
    expect(out.map((r) => r.id)).toEqual(['fresh']);
  });
});

describe('getHealthRecords', () => {
  it('throws when workerUid missing', async () => {
    const db = makeFakeDb();
    await expect(getHealthRecords('', db)).rejects.toThrow(HealthRecordError);
  });
});

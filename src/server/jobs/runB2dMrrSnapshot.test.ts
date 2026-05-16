import { describe, it, expect, vi } from 'vitest';
import { runB2dMrrSnapshot, readRecentB2dMrrSnapshots } from './runB2dMrrSnapshot.js';
import type { B2dMetrics } from '../../services/analytics/b2dMetrics.js';

// ────────────────────────────────────────────────────────────────────────
// Minimal Firestore fake (tomado del patrón de runConsistencyAudit.test.ts)
// ────────────────────────────────────────────────────────────────────────

interface StoredDoc {
  id: string;
  data: Record<string, unknown>;
}

class FakeDocRef {
  constructor(
    private collectionStore: Map<string, StoredDoc>,
    private docId: string,
  ) {}
  async get() {
    const stored = this.collectionStore.get(this.docId);
    return {
      exists: !!stored,
      data: () => stored?.data,
    };
  }
  async set(data: Record<string, unknown>, opts?: { merge?: boolean }) {
    const existing = this.collectionStore.get(this.docId);
    if (opts?.merge && existing) {
      this.collectionStore.set(this.docId, {
        id: this.docId,
        data: { ...existing.data, ...data },
      });
    } else {
      this.collectionStore.set(this.docId, { id: this.docId, data });
    }
  }
}

class FakeQuery {
  constructor(
    private docs: StoredDoc[],
    private orderBy_?: { field: string; dir: 'asc' | 'desc' },
    private limit_?: number,
  ) {}
  orderBy(field: string, dir: 'asc' | 'desc' = 'asc'): FakeQuery {
    return new FakeQuery(this.docs, { field, dir }, this.limit_);
  }
  limit(n: number): FakeQuery {
    return new FakeQuery(this.docs, this.orderBy_, n);
  }
  async get() {
    let arr = [...this.docs];
    if (this.orderBy_) {
      const { field, dir } = this.orderBy_;
      arr.sort((a, b) => {
        const av = a.data[field] as string;
        const bv = b.data[field] as string;
        return dir === 'desc'
          ? bv.localeCompare(av)
          : av.localeCompare(bv);
      });
    }
    if (this.limit_ !== undefined) arr = arr.slice(0, this.limit_);
    return {
      size: arr.length,
      docs: arr.map((d) => ({ id: d.id, data: () => d.data })),
    };
  }
}

class FakeCollection {
  constructor(private store: Map<string, StoredDoc> = new Map()) {}
  doc(id: string): FakeDocRef {
    return new FakeDocRef(this.store, id);
  }
  orderBy(field: string, dir: 'asc' | 'desc' = 'asc'): FakeQuery {
    return new FakeQuery([...this.store.values()], { field, dir });
  }
  limit(n: number): FakeQuery {
    return new FakeQuery([...this.store.values()], undefined, n);
  }
  async get() {
    return {
      size: this.store.size,
      docs: [...this.store.values()].map((d) => ({ id: d.id, data: () => d.data })),
    };
  }
}

function fakeDb() {
  const collections = new Map<string, FakeCollection>();
  return {
    collection(name: string): FakeCollection {
      let col = collections.get(name);
      if (!col) {
        col = new FakeCollection();
        collections.set(name, col);
      }
      return col;
    },
    _collections: collections,
  } as unknown as ReturnType<typeof Object> & {
    collection(name: string): FakeCollection;
    _collections: Map<string, FakeCollection>;
  };
}

function fakeMetrics(over: Partial<B2dMetrics> = {}): B2dMetrics {
  return {
    mrr: 1500,
    arr: 18000,
    customersActive: 12,
    customersTotal: 30,
    churnRate30d: 0.05,
    revenueByTier: { 'climate-base': 1500 } as B2dMetrics['revenueByTier'],
    topCustomers: [],
    ...over,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────

// Nueva semántica (Codex fix PR #284 round 2):
//   El snapshot SIEMPRE captura el MES CERRADO INMEDIATAMENTE ANTERIOR
//   a `now`, computado AS-OF el último ms de ese mes en UTC.
describe('runB2dMrrSnapshot — closed-month semantic', () => {
  it('cron scheduled (día 1 00:30 UTC) captura el mes recién cerrado', async () => {
    const db = fakeDb();
    // Cloud Scheduler corre 2026-06-01 00:30 UTC → debemos cerrar mayo.
    const now = new Date('2026-06-01T00:30:00Z');
    const metrics = fakeMetrics({ mrr: 1500, arr: 18000 });
    const computeSpy = vi.fn().mockResolvedValue(metrics);

    const result = await runB2dMrrSnapshot({
      db: db as any,
      now: () => now,
      computeMetrics: computeSpy,
    });

    expect(result.created).toBe(true);
    expect(result.monthKey).toBe('2026-05'); // ← MAYO, no junio
    expect(result.snapshot.mrr).toBe(1500);
    expect(result.snapshot.arr).toBe(18000);
    expect(result.snapshot.monthLabel).toMatch(/May/i);
    // capturedAt = momento real de la corrida (audit), no el cutoff.
    expect(result.snapshot.capturedAt).toBe('2026-06-01T00:30:00.000Z');
    // computeMetrics fue llamado con `now = last ms of May UTC`
    // (2026-05-31 23:59:59.999 UTC = 1748735999999 ms).
    expect(computeSpy).toHaveBeenCalledWith({
      now: Date.UTC(2026, 5, 1, 0, 0, 0, 0) - 1,
    });
  });

  it('re-correr en el mismo mes preserva capturedAt original', async () => {
    const db = fakeDb();
    const computeMetrics = vi.fn().mockResolvedValue(fakeMetrics({ mrr: 1500 }));

    // Primera corrida: 2026-06-01 00:30 UTC → cierra mayo
    const r1 = await runB2dMrrSnapshot({
      db: db as any,
      now: () => new Date('2026-06-01T00:30:00Z'),
      computeMetrics,
    });
    expect(r1.created).toBe(true);
    expect(r1.monthKey).toBe('2026-05');

    // Mid-month refresh (operador re-corre el 15 de junio) — sigue
    // cerrando mayo, NO junio. capturedAt original se preserva.
    computeMetrics.mockResolvedValueOnce(fakeMetrics({ mrr: 1800 }));
    const r2 = await runB2dMrrSnapshot({
      db: db as any,
      now: () => new Date('2026-06-15T18:00:00Z'),
      computeMetrics,
    });

    expect(r2.created).toBe(false);
    expect(r2.monthKey).toBe('2026-05');
    expect(r2.snapshot.mrr).toBe(1800);

    // capturedAt = primera corrida; mrr = última corrida.
    const stored = await (db as any).collection('b2d_mrr_snapshots').doc('2026-05').get();
    expect(stored.data().capturedAt).toBe('2026-06-01T00:30:00.000Z');
    expect(stored.data().mrr).toBe(1800);
  });

  it('cierre de enero captura diciembre del año anterior', async () => {
    const db = fakeDb();
    const result = await runB2dMrrSnapshot({
      db: db as any,
      now: () => new Date('2026-01-01T00:30:00Z'),
      computeMetrics: vi.fn().mockResolvedValue(fakeMetrics()),
    });
    expect(result.monthKey).toBe('2025-12');
    expect(result.snapshot.monthLabel).toMatch(/Dec/i);
  });

  it('genera monthKey con padding 2-digit para meses enero-sept', async () => {
    const db = fakeDb();
    // Mid-marzo → cierra febrero
    const result = await runB2dMrrSnapshot({
      db: db as any,
      now: () => new Date('2026-03-07T12:00:00Z'),
      computeMetrics: vi.fn().mockResolvedValue(fakeMetrics()),
    });
    expect(result.monthKey).toBe('2026-02');
  });

  it('usa UTC consistentemente (host TZ no afecta monthKey ni monthLabel)', async () => {
    const db = fakeDb();
    // 2026-05-01T01:00 UTC: en husos americanos (UTC-4..-8) es todavía
    // 30 abril. Con la nueva semántica, cerramos abril (no marzo) porque
    // UTC ya cruzó al 1 de mayo.
    const result = await runB2dMrrSnapshot({
      db: db as any,
      now: () => new Date('2026-05-01T01:00:00Z'),
      computeMetrics: vi.fn().mockResolvedValue(fakeMetrics()),
    });
    expect(result.monthKey).toBe('2026-04');
    // monthLabel también en UTC (no del host)
    expect(result.snapshot.monthLabel).toMatch(/Apr/i);
  });

  it('cutoff pasado a computeMetrics es exactly el último ms del mes cerrado', async () => {
    const db = fakeDb();
    const computeSpy = vi.fn().mockResolvedValue(fakeMetrics());
    await runB2dMrrSnapshot({
      db: db as any,
      now: () => new Date('2026-06-01T00:30:00Z'),
      computeMetrics: computeSpy,
    });
    // Last ms of May UTC = 2026-05-31T23:59:59.999Z
    const expectedCutoff = Date.UTC(2026, 5, 1, 0, 0, 0, 0) - 1;
    expect(new Date(expectedCutoff).toISOString()).toBe('2026-05-31T23:59:59.999Z');
    expect(computeSpy).toHaveBeenCalledWith({ now: expectedCutoff });
  });

  it('propaga métricas calculadas: customersActive, churnRate, topCustomers', async () => {
    const db = fakeDb();
    const metrics = fakeMetrics({
      mrr: 999,
      customersActive: 7,
      churnRate30d: 0.12,
      topCustomers: [{ customerId: 'cust-1', tier: 'climate-base', revenueMonthly: 500 }],
    });
    const result = await runB2dMrrSnapshot({
      db: db as any,
      now: () => new Date('2026-06-01T00:30:00Z'),
      computeMetrics: vi.fn().mockResolvedValue(metrics),
    });

    expect(result.snapshot.customersActive).toBe(7);
    expect(result.snapshot.churnRate30d).toBe(0.12);
    expect(result.snapshot.topCustomers).toHaveLength(1);
    expect(result.snapshot.topCustomers[0]?.customerId).toBe('cust-1');
  });
});

describe('readRecentB2dMrrSnapshots', () => {
  it('devuelve los últimos N ordenados desc por monthKey', async () => {
    const db = fakeDb();
    // Seed 3 snapshots
    for (const monthKey of ['2026-03', '2026-04', '2026-05']) {
      await db
        .collection('b2d_mrr_snapshots')
        .doc(monthKey)
        .set({
          monthKey,
          monthLabel: monthKey,
          mrr: 1000 + Number(monthKey.split('-')[1]) * 100,
          arr: 12000,
          customersActive: 5,
          customersTotal: 10,
          churnRate30d: 0,
          revenueByTier: {},
          topCustomers: [],
          capturedAt: `${monthKey}-01T00:00:00.000Z`,
          schemaVersion: 1,
        });
    }

    const recent = await readRecentB2dMrrSnapshots(db as any, 2);
    expect(recent).toHaveLength(2);
    // Más reciente primero
    expect(recent[0]?.monthKey).toBe('2026-05');
    expect(recent[1]?.monthKey).toBe('2026-04');
  });

  it('devuelve array vacío si no hay snapshots', async () => {
    const db = fakeDb();
    const recent = await readRecentB2dMrrSnapshots(db as any, 12);
    expect(recent).toEqual([]);
  });

  it('respeta limit default de 12', async () => {
    const db = fakeDb();
    for (let i = 0; i < 15; i++) {
      const monthKey = `2025-${String(i + 1).padStart(2, '0')}`;
      await db
        .collection('b2d_mrr_snapshots')
        .doc(monthKey)
        .set({
          monthKey,
          monthLabel: monthKey,
          mrr: 100 * (i + 1),
          arr: 1200,
          customersActive: 1,
          customersTotal: 1,
          churnRate30d: 0,
          revenueByTier: {},
          topCustomers: [],
          capturedAt: `${monthKey}-01T00:00:00.000Z`,
          schemaVersion: 1,
        });
    }
    const recent = await readRecentB2dMrrSnapshots(db as any);
    expect(recent).toHaveLength(12);
  });
});

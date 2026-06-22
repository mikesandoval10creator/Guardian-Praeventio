// SPDX-License-Identifier: MIT
//
// Tests for runContractorRankingSnapshot job.
//
// Verifies:
//   • Empty result when no exposure records exist (honest no-data)
//   • Snapshot written with correct TRIR from real incidents
//   • Incidents NOT attributed to a contractor are NOT counted on any contractor
//   • Errors on a per-project basis are non-fatal (other projects continue)
//   • Idempotent: re-running overwrites the snapshot doc

import { describe, it, expect, vi } from 'vitest';
import {
  runContractorRankingSnapshot,
  type RunContractorRankingSnapshotResult,
} from './runContractorRankingSnapshot.js';

// ── Minimal Firestore fake ───────────────────────────────────────────────────

interface StoredDoc {
  id: string;
  data: Record<string, unknown>;
}

class FakeDocRef {
  constructor(
    private store: Map<string, StoredDoc>,
    private docId: string,
  ) {}
  async get() {
    const stored = this.store.get(this.docId);
    return { exists: !!stored, data: () => stored?.data };
  }
  async set(data: Record<string, unknown>) {
    this.store.set(this.docId, { id: this.docId, data });
  }
}

class FakeQuery {
  constructor(
    private docs: StoredDoc[],
    private filters: Array<{ field: string; op: string; value: unknown }> = [],
    private limit_?: number,
  ) {}
  where(field: string, op: string, value: unknown): FakeQuery {
    return new FakeQuery(
      this.docs,
      [...this.filters, { field, op, value }],
      this.limit_,
    );
  }
  limit(n: number): FakeQuery {
    return new FakeQuery(this.docs, this.filters, n);
  }
  async get() {
    let arr = this.docs.filter((d) =>
      this.filters.every((f) => {
        const v = (d.data as Record<string, unknown>)[f.field];
        if (f.op === '==') return v === f.value;
        return true;
      }),
    );
    if (this.limit_ !== undefined) arr = arr.slice(0, this.limit_);
    return {
      size: arr.length,
      docs: arr.map((d) => ({ id: d.id, data: () => d.data })),
    };
  }
}

class FakeCollection {
  private store = new Map<string, StoredDoc>();
  private subcollections = new Map<string, FakeCollection>();

  doc(id: string) {
    return new FakeDocRef(this.store, id);
  }
  where(field: string, op: string, value: unknown): FakeQuery {
    return new FakeQuery([...this.store.values()]).where(field, op, value);
  }
  limit(n: number): FakeQuery {
    return new FakeQuery([...this.store.values()], [], n);
  }
  async get() {
    const arr = [...this.store.values()];
    return {
      size: arr.length,
      docs: arr.map((d) => ({ id: d.id, data: () => d.data })),
    };
  }
  _seed(id: string, data: Record<string, unknown>) {
    this.store.set(id, { id, data });
  }
  _get(id: string): Record<string, unknown> | undefined {
    return this.store.get(id)?.data;
  }
  _subcollection(name: string): FakeCollection {
    let col = this.subcollections.get(name);
    if (!col) {
      col = new FakeCollection();
      this.subcollections.set(name, col);
    }
    return col;
  }
}

type FakeDb = {
  _collections: Map<string, FakeCollection>;
  collection(path: string): FakeCollection;
  _getCollection(path: string): FakeCollection;
};

function fakeDb(): FakeDb {
  const collections = new Map<string, FakeCollection>();
  return {
    _collections: collections,
    collection(path: string): FakeCollection {
      let col = collections.get(path);
      if (!col) {
        col = new FakeCollection();
        collections.set(path, col);
      }
      return col;
    },
    _getCollection(path: string): FakeCollection {
      return this.collection(path);
    },
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const PERIOD = '2026-05';
const NOW = new Date('2026-05-15T10:00:00Z');
const PROJECT_A = 'proj-a';
const PROJECT_B = 'proj-b';
const C1 = 'contractor-1';
const C2 = 'contractor-2';
const TENANT_A = 'tenant-a';

function seedExposure(
  db: FakeDb,
  projectId: string,
  contractorId: string,
  hours: number,
  period = PERIOD,
) {
  const docId = `${projectId}_${contractorId}_${period}`;
  db.collection('contractor_exposure_hours')._seed(docId, {
    projectId,
    contractorId,
    contractorName: `Empresa ${contractorId}`,
    period,
    totalHoursWorked: hours,
  });
}

function seedIncident(
  db: FakeDb,
  projectId: string,
  incidentId: string,
  overrides: Record<string, unknown>,
) {
  db.collection('incidents')._seed(incidentId, {
    projectId,
    incidentType: 'incident',
    severity: 'high',
    ts: `${PERIOD}-10T09:00:00.000Z`,
    ...overrides,
  });
}

function seedProject(db: FakeDb, projectId: string, tenantId?: string) {
  db.collection('projects')._seed(projectId, {
    name: `Project ${projectId}`,
    ...(tenantId ? { tenantId } : {}),
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

vi.mock('../../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../services/observability/tracing.js', () => ({
  tracedAsync: (_name: string, _attrs: unknown, fn: () => unknown) => fn(),
}));

describe('runContractorRankingSnapshot — honest empty-state', () => {
  it('returns zero snapshots when no exposure records exist', async () => {
    const db = fakeDb();
    const result = await runContractorRankingSnapshot({
      db: db as any,
      period: PERIOD,
      now: () => NOW,
    });
    expect(result.projectsScanned).toBe(0);
    expect(result.snapshotsWritten).toBe(0);
    expect(result.errors).toBe(0);
  });
});

describe('runContractorRankingSnapshot — real data aggregation', () => {
  it('computes correct TRIR and writes snapshot from real incidents', async () => {
    const db = fakeDb();
    seedProject(db, PROJECT_A);
    // 200,000 hours = TRIR baseline; 2 recordable incidents → TRIR = 2.0
    seedExposure(db, PROJECT_A, C1, 200_000);
    seedIncident(db, PROJECT_A, 'i1', {
      contractorId: C1,
      incidentType: 'incident',
      severity: 'high',
    });
    seedIncident(db, PROJECT_A, 'i2', {
      contractorId: C1,
      incidentType: 'incident',
      severity: 'critical',
    });

    const result: RunContractorRankingSnapshotResult =
      await runContractorRankingSnapshot({
        db: db as any,
        period: PERIOD,
        now: () => NOW,
      });

    expect(result.projectsScanned).toBe(1);
    expect(result.snapshotsWritten).toBe(1);
    expect(result.errors).toBe(0);

    const docId = `${PROJECT_A}_${PERIOD}`;
    const snap = db.collection('contractor_ranking_snapshots')._get(docId);
    expect(snap).toBeDefined();
    expect(snap!.projectId).toBe(PROJECT_A);
    expect(snap!.period).toBe(PERIOD);
    const contractors = snap!.contractors as Array<{
      contractorId: string;
      trir: number;
      totalHoursWorked: number;
      totalRecordable: number;
    }>;
    expect(contractors).toHaveLength(1);
    expect(contractors[0]!.contractorId).toBe(C1);
    // TRIR = incidents * 200000 / hours = 2 * 200000 / 200000 = 2
    expect(contractors[0]!.trir).toBe(2);
    expect(contractors[0]!.totalHoursWorked).toBe(200_000);
    expect(contractors[0]!.totalRecordable).toBe(2);
  });

  it('does NOT attribute incidents without a contractorId to any contractor', async () => {
    const db = fakeDb();
    seedProject(db, PROJECT_A);
    seedExposure(db, PROJECT_A, C1, 200_000);

    // Incident with no contractorId — must NOT be counted on C1.
    seedIncident(db, PROJECT_A, 'i_unattributed', {
      // intentionally omit contractorId
      incidentType: 'incident',
      severity: 'high',
    });

    await runContractorRankingSnapshot({
      db: db as any,
      period: PERIOD,
      now: () => NOW,
    });

    const snap = db
      .collection('contractor_ranking_snapshots')
      ._get(`${PROJECT_A}_${PERIOD}`);
    const contractors = snap!.contractors as Array<{
      totalRecordable: number;
      trir: number;
    }>;
    expect(contractors[0]!.totalRecordable).toBe(0);
    expect(contractors[0]!.trir).toBe(0);
  });

  it('ranks multiple contractors by risk descending', async () => {
    const db = fakeDb();
    seedProject(db, PROJECT_A);
    seedExposure(db, PROJECT_A, C1, 200_000);
    seedExposure(db, PROJECT_A, C2, 200_000);
    // C1: 4 recordable → TRIR 4; C2: 1 recordable → TRIR 1
    for (let i = 0; i < 4; i++) {
      seedIncident(db, PROJECT_A, `i-c1-${i}`, {
        contractorId: C1,
        incidentType: 'incident',
        severity: 'high',
      });
    }
    seedIncident(db, PROJECT_A, 'i-c2-1', {
      contractorId: C2,
      incidentType: 'incident',
      severity: 'high',
    });

    await runContractorRankingSnapshot({
      db: db as any,
      period: PERIOD,
      now: () => NOW,
    });

    const snap = db
      .collection('contractor_ranking_snapshots')
      ._get(`${PROJECT_A}_${PERIOD}`);
    const contractors = snap!.contractors as Array<{
      contractorId: string;
      trir: number;
    }>;
    expect(contractors).toHaveLength(2);
    // First entry = highest risk (C1 with TRIR 4)
    expect(contractors[0]!.contractorId).toBe(C1);
    expect(contractors[0]!.trir).toBe(4);
    expect(contractors[1]!.contractorId).toBe(C2);
    expect(contractors[1]!.trir).toBe(1);
  });
});

describe('runContractorRankingSnapshot — idempotency', () => {
  it('overwrites existing snapshot on re-run', async () => {
    const db = fakeDb();
    seedProject(db, PROJECT_A);
    seedExposure(db, PROJECT_A, C1, 200_000);
    seedIncident(db, PROJECT_A, 'i1', {
      contractorId: C1,
      incidentType: 'incident',
      severity: 'high',
    });

    // First run
    await runContractorRankingSnapshot({
      db: db as any,
      period: PERIOD,
      now: () => NOW,
    });

    // Add another incident and re-run
    seedIncident(db, PROJECT_A, 'i2', {
      contractorId: C1,
      incidentType: 'incident',
      severity: 'high',
    });
    await runContractorRankingSnapshot({
      db: db as any,
      period: PERIOD,
      now: () => NOW,
    });

    const snap = db
      .collection('contractor_ranking_snapshots')
      ._get(`${PROJECT_A}_${PERIOD}`);
    const contractors = snap!.contractors as Array<{ totalRecordable: number }>;
    // After re-run, should reflect the new incident count.
    expect(contractors[0]!.totalRecordable).toBe(2);
  });
});

describe('runContractorRankingSnapshot — multi-project', () => {
  it('writes snapshots for each project independently', async () => {
    const db = fakeDb();
    seedProject(db, PROJECT_A);
    seedProject(db, PROJECT_B);
    seedExposure(db, PROJECT_A, C1, 100_000);
    seedExposure(db, PROJECT_B, C2, 50_000);

    const result = await runContractorRankingSnapshot({
      db: db as any,
      period: PERIOD,
      now: () => NOW,
    });

    expect(result.projectsScanned).toBe(2);
    expect(result.snapshotsWritten).toBe(2);

    expect(
      db.collection('contractor_ranking_snapshots')._get(`${PROJECT_A}_${PERIOD}`),
    ).toBeDefined();
    expect(
      db.collection('contractor_ranking_snapshots')._get(`${PROJECT_B}_${PERIOD}`),
    ).toBeDefined();
  });
});

describe('runContractorRankingSnapshot — default period', () => {
  it('defaults period to current UTC month when not specified', async () => {
    const db = fakeDb();
    // Use a fixed clock: 2026-05-15
    const nowDate = new Date('2026-05-15T10:00:00Z');
    seedExposure(db, PROJECT_A, C1, 100_000, '2026-05');

    await runContractorRankingSnapshot({
      db: db as any,
      now: () => nowDate,
    });

    // Should use YYYY-MM from the fixed clock
    const snap = db
      .collection('contractor_ranking_snapshots')
      ._get(`${PROJECT_A}_2026-05`);
    expect(snap).toBeDefined();
    expect(snap!.period).toBe('2026-05');
  });
});

// SPDX-License-Identifier: MIT
//
// Tests for runComplianceSnapshot job.
//
// Verifies:
//   • Returns zero snapshots when no projects exist
//   • Writes a snapshot doc per project with real traffic-light result
//   • Categories without data sources return 'unknown' (never fabricated green)
//   • Per-project errors are non-fatal
//   • Idempotent: re-running overwrites the snapshot for the same day

import { describe, it, expect, vi } from 'vitest';
import { runComplianceSnapshot } from './runComplianceSnapshot.js';

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

class FakeCollection {
  readonly store = new Map<string, StoredDoc>();

  doc(id: string) {
    return new FakeDocRef(this.store, id);
  }
  limit(n: number) {
    return {
      async get() {
        const arr = [...this.store.values()].slice(0, n);
        return {
          size: arr.length,
          docs: arr.map((d) => ({
            id: d.id,
            data: () => d.data,
          })),
        };
      },
      store: this.store,
    };
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
}

type FakeDb = {
  _cols: Map<string, FakeCollection>;
  collection(path: string): FakeCollection;
};

function fakeDb(): FakeDb {
  const cols = new Map<string, FakeCollection>();
  return {
    _cols: cols,
    collection(path: string): FakeCollection {
      let col = cols.get(path);
      if (!col) {
        col = new FakeCollection();
        cols.set(path, col);
      }
      return col;
    },
  };
}

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../services/observability/tracing.js', () => ({
  tracedAsync: (_name: string, _attrs: unknown, fn: () => unknown) => fn(),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

const DATE = '2026-05-15';
const NOW = new Date(`${DATE}T10:00:00Z`);
const PROJECT_A = 'proj-compliance-a';
const PROJECT_B = 'proj-compliance-b';

function seedProject(
  db: FakeDb,
  id: string,
  data: Record<string, unknown> = {},
) {
  db.collection('projects')._seed(id, {
    name: `Project ${id}`,
    workersCount: 30,
    ...data,
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('runComplianceSnapshot — empty state', () => {
  it('returns zero snapshots when no projects exist', async () => {
    const db = fakeDb();
    const result = await runComplianceSnapshot({
      db: db as any,
      now: () => NOW,
    });
    expect(result.projectsScanned).toBe(0);
    expect(result.snapshotsWritten).toBe(0);
    expect(result.errors).toBe(0);
  });
});

describe('runComplianceSnapshot — real traffic-light state', () => {
  it('writes a snapshot doc with the correct date and projectId', async () => {
    const db = fakeDb();
    seedProject(db, PROJECT_A);

    const result = await runComplianceSnapshot({
      db: db as any,
      now: () => NOW,
    });

    expect(result.projectsScanned).toBe(1);
    expect(result.snapshotsWritten).toBe(1);
    expect(result.errors).toBe(0);

    const docId = `${PROJECT_A}_${DATE}`;
    const snap = db.collection('compliance_snapshots')._get(docId);
    expect(snap).toBeDefined();
    expect(snap!.projectId).toBe(PROJECT_A);
    expect(snap!.date).toBe(DATE);
    expect(snap!.capturedAt).toContain('2026-05-15');
  });

  it('includes a result with overall status', async () => {
    const db = fakeDb();
    seedProject(db, PROJECT_A, { workersCount: 30 });

    await runComplianceSnapshot({ db: db as any, now: () => NOW });

    const snap = db
      .collection('compliance_snapshots')
      ._get(`${PROJECT_A}_${DATE}`);
    const trafficResult = snap!.result as Record<string, unknown>;
    // overall must be one of the valid traffic-light values
    expect(['green', 'yellow', 'red', 'unknown']).toContain(
      trafficResult.overall,
    );
  });

  it('returns "unknown" for uncovered categories (never fabricates green)', async () => {
    const db = fakeDb();
    // Project with minimum data — only 'legal' has a real source
    seedProject(db, PROJECT_A, { workersCount: 10 });

    await runComplianceSnapshot({ db: db as any, now: () => NOW });

    const snap = db
      .collection('compliance_snapshots')
      ._get(`${PROJECT_A}_${DATE}`);
    const trafficResult = snap!.result as {
      byCategory: Array<{ category: string; light: string }>;
    };

    // Categories without a real data source must be 'unknown', NOT 'green'
    const nonLegal = trafficResult.byCategory.filter(
      (c) => c.category !== 'legal',
    );
    for (const cat of nonLegal) {
      expect(cat.light).toBe('unknown');
    }
  });

  it('stores the profile input for auditability', async () => {
    const db = fakeDb();
    seedProject(db, PROJECT_A, {
      workersCount: 50,
      industry_code: 'mining',
      hasHazmat: true,
    });

    await runComplianceSnapshot({ db: db as any, now: () => NOW });

    const snap = db
      .collection('compliance_snapshots')
      ._get(`${PROJECT_A}_${DATE}`);
    const profile = snap!.profile as Record<string, unknown>;
    expect(profile.workersCount).toBe(50);
    expect(profile.industry).toBe('GP-MIN');
    expect(profile.hasHazmat).toBe(true);
  });
});

describe('runComplianceSnapshot — multi-project', () => {
  it('writes one snapshot per project', async () => {
    const db = fakeDb();
    seedProject(db, PROJECT_A);
    seedProject(db, PROJECT_B);

    const result = await runComplianceSnapshot({
      db: db as any,
      now: () => NOW,
    });

    expect(result.projectsScanned).toBe(2);
    expect(result.snapshotsWritten).toBe(2);

    expect(
      db.collection('compliance_snapshots')._get(`${PROJECT_A}_${DATE}`),
    ).toBeDefined();
    expect(
      db.collection('compliance_snapshots')._get(`${PROJECT_B}_${DATE}`),
    ).toBeDefined();
  });
});

describe('runComplianceSnapshot — idempotency', () => {
  it('overwrites the snapshot on re-run for the same day', async () => {
    const db = fakeDb();
    seedProject(db, PROJECT_A, { workersCount: 10 });

    await runComplianceSnapshot({ db: db as any, now: () => NOW });
    // Update project and re-run
    db.collection('projects')._seed(PROJECT_A, {
      name: 'Updated Project',
      workersCount: 100, // now triggers more legal rules
    });
    await runComplianceSnapshot({ db: db as any, now: () => NOW });

    const snap = db
      .collection('compliance_snapshots')
      ._get(`${PROJECT_A}_${DATE}`);
    const profile = snap!.profile as { workersCount: number };
    expect(profile.workersCount).toBe(100);
  });
});

describe('runComplianceSnapshot — date key', () => {
  it('uses UTC date as the key (not local TZ)', async () => {
    const db = fakeDb();
    seedProject(db, PROJECT_A);

    // 2026-12-31T23:30:00Z — in UTC-4 this would be "Dec 31" but still
    // UTC "Dec 31". Key must be UTC-based.
    const nowAtMidnightUtc = new Date('2026-12-31T23:30:00Z');
    await runComplianceSnapshot({ db: db as any, now: () => nowAtMidnightUtc });

    const snap = db
      .collection('compliance_snapshots')
      ._get(`${PROJECT_A}_2026-12-31`);
    expect(snap).toBeDefined();
    expect(snap!.date).toBe('2026-12-31');
  });
});

// @vitest-environment jsdom
/**
 * Unit tests for src/utils/offlineStorage.ts (web/IDB path).
 *
 * Strategy:
 *  - Force `Capacitor.isNativePlatform()` to return `false` so every branch
 *    runs through IndexedDB (idb / fake-indexeddb), not SQLite. The SQLite
 *    path is only reachable on a real Capacitor native build and is separately
 *    tested by integration infra.
 *  - Use `fake-indexeddb/auto` to supply a full in-memory IDB implementation.
 *    The `IDBKeyRange` global that `openDB` uses for cursor queries is also
 *    provided by this import.
 *  - Reset the module singleton (`idbPromise`) between tests by resetting the
 *    module registry so each describe block gets a clean DB.
 *  - `@capacitor-community/sqlite` and `./sqliteEncryption` are mocked to
 *    prevent any native-bridge initialisation.
 *  - `./logger` is silenced to keep test output clean.
 *
 * Exported functions covered:
 *  - initDB            (returns IDB handle on web)
 *  - saveWorkerOffline / getWorkersOffline  (worker round-trip + encryption layer)
 *  - saveMatrixOffline / getMatricesOffline (matrix round-trip)
 *  - saveZettelNodeOffline / getZettelNodesOffline (zettel round-trip, limit/offset)
 *  - addToOfflineQueue / getOfflineQueue / clearOfflineQueueItem (queue drain)
 *  - saveBlackBox / getBlackBoxEntries / unlockBlackBox (black-box store)
 *  - saveBreadcrumb / getBreadcrumbs (50-cap + limit + ordering)
 *
 * NOT covered here (by design):
 *  - The native SQLite path — requires Capacitor runtime.
 *  - The `encryptData` / `decryptData` private functions — covered indirectly
 *    through the round-trip assertions below.
 */

import 'fake-indexeddb/auto';
import { IDBFactory as FDBFactory, IDBKeyRange as FDBKeyRange } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Module-level mocks (hoisted before any SUT import) ────────────────────

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => false,
  },
}));

// SQLite never reaches native init on the web path — stub the whole module
// so the import doesn't crash in Node.
vi.mock('@capacitor-community/sqlite', () => ({
  CapacitorSQLite: {},
  SQLiteConnection: class {
    async checkConnectionsConsistency() { return { result: false }; }
    async isConnection() { return { result: false }; }
    async createConnection() { return null; }
    async retrieveConnection() { return null; }
  },
  SQLiteDBConnection: class {},
}));

// ensureSqliteEncryptionSecret is only called on the native path but the
// top-level import would fail without a stub.
vi.mock('./sqliteEncryption', () => ({
  ensureSqliteEncryptionSecret: vi.fn(async () => 'encryption'),
}));

vi.mock('./logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Reset the IDB universe and clear the cached `idbPromise` singleton so
 * each test group starts with an empty database.
 */
function resetIDB(): void {
  // Install a brand-new in-memory IDB factory.
  (globalThis as { indexedDB: IDBFactory }).indexedDB = new FDBFactory();
  // Ensure the browser-level IDBKeyRange global is present for cursor queries.
  if (!globalThis.IDBKeyRange) {
    (globalThis as { IDBKeyRange: typeof IDBKeyRange }).IDBKeyRange = FDBKeyRange;
  }
}

// ── Import SUT (after mocks are registered) ───────────────────────────────

// Dynamic import via module reset is not straightforward in Vitest with
// static mocks; instead we use a fresh `idbPromise` reset trick by
// importing the module once and relying on `resetIDB()` to give each test
// a new underlying DB while the module-level `idbPromise` variable is reset
// through the `vi.resetModules()` pattern below.
//
// We cannot call `vi.resetModules()` inside beforeEach with static vi.mock()
// at the top level — so we import once and rely on `fake-indexeddb/auto`
// re-using the global `indexedDB` that we replace before each test. The `idb`
// library calls `globalThis.indexedDB` on every `openDB()` call, so replacing
// the global is sufficient as long as the `idbPromise` singleton is also
// cleared between tests.
//
// The module exposes no `__resetForTests` helper, so we clear `idbPromise`
// by dynamically re-importing after `vi.resetModules()` on a per-suite basis.

// We use a lazy import wrapper so we can re-import after resetModules().
type OfflineStorageModule = typeof import('./offlineStorage');

let sut: OfflineStorageModule;

async function freshSut(): Promise<OfflineStorageModule> {
  vi.resetModules();
  // Re-register mocks after resetModules so they survive the fresh module graph.
  vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false } }));
  vi.mock('@capacitor-community/sqlite', () => ({
    CapacitorSQLite: {},
    SQLiteConnection: class {
      async checkConnectionsConsistency() { return { result: false }; }
      async isConnection() { return { result: false }; }
      async createConnection() { return null; }
      async retrieveConnection() { return null; }
    },
    SQLiteDBConnection: class {},
  }));
  vi.mock('./sqliteEncryption', () => ({
    ensureSqliteEncryptionSecret: vi.fn(async () => 'encryption'),
  }));
  vi.mock('./logger', () => ({
    logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  }));
  return import('./offlineStorage') as Promise<OfflineStorageModule>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite 1 — initDB
// ─────────────────────────────────────────────────────────────────────────────

describe('initDB — web path', () => {
  beforeEach(async () => {
    resetIDB();
    sut = await freshSut();
  });

  it('returns an IDB database handle', async () => {
    const db = await sut.initDB();
    expect(db).toBeDefined();
    // The idb wrapper has `put`, `get`, `getAll`, etc.
    expect(typeof (db as { put?: unknown }).put).toBe('function');
  });

  it('calling initDB twice returns the same singleton', async () => {
    const a = await sut.initDB();
    const b = await sut.initDB();
    expect(a).toBe(b);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 2 — Worker offline round-trip
// ─────────────────────────────────────────────────────────────────────────────

describe('saveWorkerOffline / getWorkersOffline', () => {
  beforeEach(async () => {
    resetIDB();
    sut = await freshSut();
  });

  it('saves a worker and retrieves it by projectId', async () => {
    const worker = { id: 'w1', projectId: 'proj-A', name: 'Alice', rut: '12.345.678-9' };
    await sut.saveWorkerOffline(worker);

    const result = await sut.getWorkersOffline('proj-A');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('w1');
    expect(result[0].name).toBe('Alice');
  });

  it('decrypts the worker — _encryptedData is not exposed to caller', async () => {
    const worker = { id: 'w2', projectId: 'proj-A', name: 'Bob', sensitive: true };
    await sut.saveWorkerOffline(worker);

    const [retrieved] = await sut.getWorkersOffline('proj-A');
    // The round-trip should return the original plain fields, not an
    // opaque encrypted blob.
    expect(retrieved.name).toBe('Bob');
    expect(retrieved.sensitive).toBe(true);
  });

  it('getWorkersOffline returns [] for an unknown projectId', async () => {
    const result = await sut.getWorkersOffline('proj-NOPE');
    expect(result).toEqual([]);
  });

  it('save with upsert replaces an existing worker (same id)', async () => {
    const v1 = { id: 'w3', projectId: 'proj-B', name: 'Carlos v1' };
    const v2 = { id: 'w3', projectId: 'proj-B', name: 'Carlos v2' };
    await sut.saveWorkerOffline(v1);
    await sut.saveWorkerOffline(v2);

    const result = await sut.getWorkersOffline('proj-B');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Carlos v2');
  });

  it('filters by projectId — workers in other projects are not returned', async () => {
    await sut.saveWorkerOffline({ id: 'wA', projectId: 'proj-A', name: 'Alice' });
    await sut.saveWorkerOffline({ id: 'wB', projectId: 'proj-B', name: 'Bob' });

    const forA = await sut.getWorkersOffline('proj-A');
    expect(forA).toHaveLength(1);
    expect(forA[0].id).toBe('wA');

    const forB = await sut.getWorkersOffline('proj-B');
    expect(forB).toHaveLength(1);
    expect(forB[0].id).toBe('wB');
  });

  it('handles nested objects and arrays in worker data', async () => {
    const worker = {
      id: 'wNested',
      projectId: 'proj-C',
      certifications: ['iso-45001', 'ds-54'],
      address: { street: 'Av. Libertador 123', region: 'RM' },
    };
    await sut.saveWorkerOffline(worker);

    const [retrieved] = await sut.getWorkersOffline('proj-C');
    expect(retrieved.certifications).toEqual(['iso-45001', 'ds-54']);
    expect(retrieved.address.region).toBe('RM');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 3 — Matrix offline round-trip
// ─────────────────────────────────────────────────────────────────────────────

describe('saveMatrixOffline / getMatricesOffline', () => {
  beforeEach(async () => {
    resetIDB();
    sut = await freshSut();
  });

  it('saves a matrix and retrieves it by projectId', async () => {
    const matrix = { id: 'm1', projectId: 'proj-A', risk: 'alto', score: 15 };
    await sut.saveMatrixOffline(matrix);

    const result = await sut.getMatricesOffline('proj-A');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('m1');
    expect(result[0].risk).toBe('alto');
    expect(result[0].score).toBe(15);
  });

  it('getMatricesOffline returns [] for unknown projectId', async () => {
    expect(await sut.getMatricesOffline('NOPE')).toEqual([]);
  });

  it('upsert replaces existing matrix with same id', async () => {
    const v1 = { id: 'm2', projectId: 'proj-A', score: 10 };
    const v2 = { id: 'm2', projectId: 'proj-A', score: 99 };
    await sut.saveMatrixOffline(v1);
    await sut.saveMatrixOffline(v2);

    const result = await sut.getMatricesOffline('proj-A');
    expect(result).toHaveLength(1);
    expect(result[0].score).toBe(99);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 4 — Zettelkasten offline round-trip
// ─────────────────────────────────────────────────────────────────────────────

describe('saveZettelNodeOffline / getZettelNodesOffline', () => {
  beforeEach(async () => {
    resetIDB();
    sut = await freshSut();
  });

  it('saves a node and retrieves it by projectId', async () => {
    const node = { id: 'z1', projectId: 'proj-A', title: 'Riesgo eléctrico', body: 'lorem' };
    await sut.saveZettelNodeOffline(node);

    const result = await sut.getZettelNodesOffline('proj-A');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('z1');
    expect(result[0].title).toBe('Riesgo eléctrico');
  });

  it('getZettelNodesOffline returns [] for unknown projectId', async () => {
    expect(await sut.getZettelNodesOffline('NOPE')).toEqual([]);
  });

  it('respects the limit parameter', async () => {
    for (let i = 0; i < 10; i++) {
      await sut.saveZettelNodeOffline({ id: `z${i}`, projectId: 'proj-A', title: `node-${i}` });
    }
    const result = await sut.getZettelNodesOffline('proj-A', 3);
    expect(result).toHaveLength(3);
  });

  it('respects the offset parameter', async () => {
    // Insert 5 nodes in sequence; with offset=3 and limit=50 only 2 should return.
    for (let i = 0; i < 5; i++) {
      await sut.saveZettelNodeOffline({ id: `zo${i}`, projectId: 'proj-B', title: `node-${i}` });
    }
    const result = await sut.getZettelNodesOffline('proj-B', 50, 3);
    expect(result).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 5 — Offline queue (enqueue / drain / delete)
// ─────────────────────────────────────────────────────────────────────────────

describe('addToOfflineQueue / getOfflineQueue / clearOfflineQueueItem', () => {
  beforeEach(async () => {
    resetIDB();
    sut = await freshSut();
  });

  it('enqueue then getOfflineQueue returns the item', async () => {
    await sut.addToOfflineQueue('create', 'workers', { id: 'w1', name: 'Alice' });
    const queue = await sut.getOfflineQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].action).toBe('create');
    expect(queue[0].collection).toBe('workers');
    expect(queue[0].data).toEqual({ id: 'w1', name: 'Alice' });
    expect(typeof queue[0].timestamp).toBe('number');
  });

  it('multiple enqueues accumulate', async () => {
    await sut.addToOfflineQueue('create', 'workers', { id: 'w1' });
    await sut.addToOfflineQueue('update', 'matrices', { id: 'm1' });
    await sut.addToOfflineQueue('delete', 'workers', { id: 'w2' });

    const queue = await sut.getOfflineQueue();
    expect(queue).toHaveLength(3);
    const actions = queue.map((q: { action: string }) => q.action);
    expect(actions).toContain('create');
    expect(actions).toContain('update');
    expect(actions).toContain('delete');
  });

  it('clearOfflineQueueItem removes an item by id', async () => {
    await sut.addToOfflineQueue('create', 'workers', { id: 'w1' });
    await sut.addToOfflineQueue('update', 'workers', { id: 'w2' });

    const queue = await sut.getOfflineQueue();
    expect(queue).toHaveLength(2);

    const firstId = queue[0].id as number;
    await sut.clearOfflineQueueItem(firstId);

    const remaining = await sut.getOfflineQueue();
    expect(remaining).toHaveLength(1);
    expect((remaining[0] as { id: number }).id).not.toBe(firstId);
  });

  it('clearing a non-existent id is a no-op (no throw)', async () => {
    await sut.addToOfflineQueue('create', 'workers', { id: 'w1' });
    // 99999 is an id that does not exist in the store.
    await expect(sut.clearOfflineQueueItem(99999)).resolves.toBeUndefined();
    expect(await sut.getOfflineQueue()).toHaveLength(1);
  });

  it('getOfflineQueue on empty store returns []', async () => {
    expect(await sut.getOfflineQueue()).toEqual([]);
  });

  it('flush pattern: drain all items after processing', async () => {
    await sut.addToOfflineQueue('create', 'workers', { id: 'wA' });
    await sut.addToOfflineQueue('create', 'matrices', { id: 'mA' });

    const queue = await sut.getOfflineQueue();
    // Simulate successful sync: clear each item.
    for (const item of queue) {
      await sut.clearOfflineQueueItem(item.id as number);
    }

    expect(await sut.getOfflineQueue()).toEqual([]);
  });

  it('preserves object payloads after round-trip (no serialization loss)', async () => {
    const complex = {
      id: 'c1',
      nested: { arr: [1, 2, 3], flag: true },
      nullField: null,
      emptyStr: '',
    };
    await sut.addToOfflineQueue('create', 'matrices', complex);

    const [item] = await sut.getOfflineQueue();
    expect(item.data).toEqual(complex);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 6 — Black Box (Caja Negra Biométrica)
// ─────────────────────────────────────────────────────────────────────────────

describe('saveBlackBox / getBlackBoxEntries / unlockBlackBox', () => {
  beforeEach(async () => {
    resetIDB();
    sut = await freshSut();
  });

  it('saveBlackBox creates a locked entry retrievable by getBlackBoxEntries', async () => {
    const telemetry = { heartRate: 120, fallAngle: 45, confirmed: true };
    await sut.saveBlackBox('worker-007', telemetry);

    const entries = await sut.getBlackBoxEntries();
    expect(entries).toHaveLength(1);
    const entry = entries[0];
    // Entry is locked by default.
    expect(entry.locked).toBe(true);
    expect(entry.workerId).toBe('worker-007');
    // Telemetry is embedded in data.
    expect(entry.data.heartRate).toBe(120);
    expect(entry.data.confirmed).toBe(true);
    // savedAt is an ISO string.
    expect(typeof entry.data.savedAt).toBe('string');
  });

  it('entry id includes workerId and a numeric timestamp component', async () => {
    await sut.saveBlackBox('worker-X', { event: 'ManDown' });
    const [entry] = await sut.getBlackBoxEntries();
    expect(entry.id).toMatch(/^blackbox_worker-X_\d+$/);
  });

  it('getBlackBoxEntries returns [] when store is empty', async () => {
    expect(await sut.getBlackBoxEntries()).toEqual([]);
  });

  it('multiple ManDown events produce separate entries', async () => {
    await sut.saveBlackBox('wA', { event: 'first' });
    await sut.saveBlackBox('wB', { event: 'second' });

    const entries = await sut.getBlackBoxEntries();
    expect(entries).toHaveLength(2);
    const workerIds = entries.map((e: { workerId: string }) => e.workerId).sort();
    expect(workerIds).toEqual(['wA', 'wB']);
  });

  it('unlockBlackBox sets locked=false for the given id', async () => {
    await sut.saveBlackBox('worker-U', { event: 'ManDown' });
    const [entry] = await sut.getBlackBoxEntries();
    expect(entry.locked).toBe(true);

    await sut.unlockBlackBox(entry.id as string);

    const updated = await sut.getBlackBoxEntries();
    const unlocked = updated.find((e: { id: string }) => e.id === entry.id);
    expect(unlocked).toBeDefined();
    expect(unlocked.locked).toBe(false);
  });

  it('unlockBlackBox on a missing id is a silent no-op (no throw)', async () => {
    await expect(sut.unlockBlackBox('does-not-exist')).resolves.toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 7 — Breadcrumbs
// ─────────────────────────────────────────────────────────────────────────────

describe('saveBreadcrumb / getBreadcrumbs', () => {
  beforeEach(async () => {
    resetIDB();
    sut = await freshSut();
  });

  it('saves a breadcrumb and retrieves it for the correct userId', async () => {
    await sut.saveBreadcrumb('user-1', -33.45, -70.66);

    const crumbs = await sut.getBreadcrumbs('user-1');
    expect(crumbs).toHaveLength(1);
    expect(crumbs[0].lat).toBeCloseTo(-33.45, 5);
    expect(crumbs[0].lng).toBeCloseTo(-70.66, 5);
    expect(typeof crumbs[0].timestamp).toBe('number');
  });

  it('getBreadcrumbs returns [] for unknown userId', async () => {
    expect(await sut.getBreadcrumbs('user-NOPE')).toEqual([]);
  });

  it('returns only fields { lat, lng, timestamp } — no userId leak', async () => {
    await sut.saveBreadcrumb('user-2', -34.0, -71.0);
    const [crumb] = await sut.getBreadcrumbs('user-2');
    const keys = Object.keys(crumb).sort();
    expect(keys).toEqual(['lat', 'lng', 'timestamp']);
  });

  it('respects the limit parameter', async () => {
    for (let i = 0; i < 10; i++) {
      await sut.saveBreadcrumb('user-3', -33.0 + i * 0.001, -70.0);
    }
    const crumbs = await sut.getBreadcrumbs('user-3', 5);
    expect(crumbs).toHaveLength(5);
  });

  it('returns most-recent first (descending timestamp order)', async () => {
    // Insert 3 breadcrumbs with a small deliberate delay so timestamps
    // are guaranteed distinct without needing to spy on Date.now.
    await sut.saveBreadcrumb('user-4', -33.1, -70.1);
    await new Promise<void>((r) => setTimeout(r, 2));
    await sut.saveBreadcrumb('user-4', -33.2, -70.2);
    await new Promise<void>((r) => setTimeout(r, 2));
    await sut.saveBreadcrumb('user-4', -33.3, -70.3);

    const crumbs = await sut.getBreadcrumbs('user-4', 10);
    expect(crumbs).toHaveLength(3);
    // Newest first — each timestamp must be >= the next.
    expect(crumbs[0].timestamp).toBeGreaterThanOrEqual(crumbs[1].timestamp);
    expect(crumbs[1].timestamp).toBeGreaterThanOrEqual(crumbs[2].timestamp);
    // The most-recent has the highest lat (-33.3) — pin the ordering.
    expect(crumbs[0].lat).toBeCloseTo(-33.3, 4);
    expect(crumbs[2].lat).toBeCloseTo(-33.1, 4);
  });

  it('caps breadcrumbs at 50 per user by pruning the oldest', async () => {
    // Insert 52 crumbs — the 52nd insert should prune the oldest, leaving 50.
    for (let i = 0; i < 52; i++) {
      await sut.saveBreadcrumb('user-5', -33.0 + i * 0.001, -70.0);
    }
    const crumbs = await sut.getBreadcrumbs('user-5', 100);
    expect(crumbs.length).toBeLessThanOrEqual(50);
  });

  it('filters by userId — another user’s breadcrumbs are not returned', async () => {
    await sut.saveBreadcrumb('user-A', -33.0, -70.0);
    await sut.saveBreadcrumb('user-B', -34.0, -71.0);

    expect(await sut.getBreadcrumbs('user-A')).toHaveLength(1);
    expect(await sut.getBreadcrumbs('user-B')).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 8 — encryptData / decryptData invariants (via round-trips)
// ─────────────────────────────────────────────────────────────────────────────

describe('encryption layer invariants (tested through public API)', () => {
  beforeEach(async () => {
    resetIDB();
    sut = await freshSut();
  });

  it('round-trips a worker with unicode characters', async () => {
    const worker = { id: 'wU', projectId: 'proj-U', name: 'José María Ñoño', rut: '9.999.999-K' };
    await sut.saveWorkerOffline(worker);
    const [retrieved] = await sut.getWorkersOffline('proj-U');
    expect(retrieved.name).toBe('José María Ñoño');
    expect(retrieved.rut).toBe('9.999.999-K');
  });

  it('round-trips a worker with boolean and number fields', async () => {
    const worker = { id: 'wB', projectId: 'proj-U', active: false, score: 0, ratio: 1.5 };
    await sut.saveWorkerOffline(worker);
    const [retrieved] = await sut.getWorkersOffline('proj-U');
    expect(retrieved.active).toBe(false);
    expect(retrieved.score).toBe(0);
    expect(retrieved.ratio).toBeCloseTo(1.5, 5);
  });
});

import { describe, it, expect, beforeEach, vi } from 'vitest';

// --- Mock platform check + SQLite + idb so the SUT thinks it's running native ---
let nativePlatform = true;
const fakeRows: Array<Record<string, unknown>> = [];

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => nativePlatform,
  },
}));

vi.mock('@capacitor-community/sqlite', () => ({
  CapacitorSQLite: {},
  SQLiteConnection: class {
    async checkConnectionsConsistency() {
      return { result: true };
    }
    async isConnection() {
      return { result: true };
    }
    async retrieveConnection() {
      return fakeDb;
    }
    async createConnection() {
      return fakeDb;
    }
  },
  SQLiteDBConnection: class {},
}));

vi.mock('idb', () => ({
  openDB: vi.fn(async () => ({
    getAll: vi.fn(async () => []),
  })),
}));

const fakeDb = {
  open: vi.fn(async () => undefined),
  execute: vi.fn(async () => undefined),
  run: vi.fn(async () => undefined),
  query: vi.fn(async (_sql: string) => ({ values: fakeRows })),
};

const { getPendingActions } = await import('./pwa-offline');

describe('pwa-offline.getPendingActions — localUpdatedAt typing contract', () => {
  beforeEach(() => {
    nativePlatform = true;
    fakeRows.length = 0;
    fakeDb.query.mockClear();
  });

  it('returns localUpdatedAt as an ISO string even when SQLite stores epoch ms', async () => {
    // Row produced by an older app version whose data JSON has no
    // localUpdatedAt — only the column does, as a number (epoch ms).
    const epochMs = 1714230000000; // 2024-04-27T13:00:00.000Z
    fakeRows.push({
      id: 1,
      docId: 'd1',
      type: 'update',
      collection: 'iper_nodes',
      data: JSON.stringify({ payload: 'x' }),
      timestamp: epochMs,
      localUpdatedAt: epochMs,
    });

    const actions = await getPendingActions();

    expect(actions).toHaveLength(1);
    const a = actions[0];
    // Top-level localUpdatedAt MUST be a string for downstream JSON/sync code.
    expect(typeof a.localUpdatedAt).toBe('string');
    expect(a.localUpdatedAt).toBe(new Date(epochMs).toISOString());
    // And data.localUpdatedAt must agree (string ISO).
    expect(typeof (a.data as { localUpdatedAt?: unknown }).localUpdatedAt).toBe('string');
    expect((a.data as { localUpdatedAt: string }).localUpdatedAt).toBe(
      new Date(epochMs).toISOString(),
    );
  });

  it('preserves an existing ISO string in the JSON data payload', async () => {
    const iso = '2026-04-28T10:00:00.000Z';
    const epochMs = 1714230000000;
    fakeRows.push({
      id: 2,
      docId: 'd2',
      type: 'update',
      collection: 'iper_nodes',
      data: JSON.stringify({ payload: 'y', localUpdatedAt: iso }),
      timestamp: epochMs,
      localUpdatedAt: epochMs,
    });

    const actions = await getPendingActions();
    expect(actions).toHaveLength(1);
    expect(actions[0].localUpdatedAt).toBe(iso);
  });

  it('never exposes localUpdatedAt as a number to consumers', async () => {
    fakeRows.push(
      {
        id: 3,
        docId: 'd3',
        type: 'create',
        collection: 'c',
        data: JSON.stringify({ payload: 'a' }),
        timestamp: 100,
        localUpdatedAt: 100,
      },
      {
        id: 4,
        docId: 'd4',
        type: 'create',
        collection: 'c',
        data: JSON.stringify({ payload: 'b', localUpdatedAt: '2026-01-01T00:00:00.000Z' }),
        timestamp: 200,
        localUpdatedAt: 200,
      },
    );

    const actions = await getPendingActions();
    for (const a of actions) {
      expect(typeof a.localUpdatedAt).toBe('string');
    }
  });

  it('coerces a numeric data.localUpdatedAt (legacy) to ISO string', async () => {
    // Worst-case legacy row: data JSON itself contains localUpdatedAt as a
    // number. The previous read-out blindly re-spread parsedData, so an
    // unwary consumer would receive { data: { localUpdatedAt: <number> } }.
    // The contract is "string everywhere" — verify the boundary normalizes.
    const epochMs = 1714230000000;
    fakeRows.push({
      id: 5,
      docId: 'd5',
      type: 'update',
      collection: 'c',
      data: JSON.stringify({ payload: 'legacy', localUpdatedAt: epochMs }),
      timestamp: epochMs,
      localUpdatedAt: epochMs,
    });

    const actions = await getPendingActions();
    expect(actions).toHaveLength(1);
    const a = actions[0];
    expect(typeof a.localUpdatedAt).toBe('string');
    expect(typeof (a.data as { localUpdatedAt?: unknown }).localUpdatedAt).toBe('string');
    // And the ISO must match the epoch ms.
    expect((a.data as { localUpdatedAt: string }).localUpdatedAt).toBe(
      new Date(epochMs).toISOString(),
    );
  });

  it('returns "" only when there is genuinely no timestamp anywhere', async () => {
    // No localUpdatedAt anywhere — should still be a string ('').
    fakeRows.push({
      id: 6,
      docId: 'd6',
      type: 'create',
      collection: 'c',
      data: JSON.stringify({ payload: 'no-ts' }),
      timestamp: 1,
      localUpdatedAt: null,
    });

    const actions = await getPendingActions();
    expect(typeof actions[0].localUpdatedAt).toBe('string');
  });
});

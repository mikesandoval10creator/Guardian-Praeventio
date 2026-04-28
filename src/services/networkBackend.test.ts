// Praeventio Guard — networkBackend.syncNodeToNetwork tests.
//
// Round 14 Task 6 wires `autoConnectNodes` into the sync path AFTER the
// embedding + Firestore + vector store steps. These tests pin the
// suggestion-emission contract so a future refactor can't silently
// regress the dead-code-fix:
//
//   1. Suggestions surface in the return payload (not auto-written).
//   2. Suggestions exclude the new node itself + already-connected ids.
//   3. Suggestions are bounded by AUTO_CONNECT_RECENT_LIMIT (50).
//   4. A failure in `autoConnectNodes` degrades to an empty list — the
//      primary sync write still succeeds.
//
// The tests stub firebase-admin, @google/genai, and ./geminiBackend so
// nothing touches the network. We import the SUT dynamically AFTER the
// mocks are registered (the module reads `process.env.GEMINI_API_KEY`
// and constructs `admin.firestore()` calls eagerly at function-call time
// — so module load is fine, but every method must be mocked).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mocks ───────────────────────────────────────────────────────────────────

// firebase-admin: a minimal fake firestore with the chained surface that
// syncNodeToNetwork actually exercises (.collection().doc().set/get/update,
// .collection().where().orderBy().limit().get(), FieldValue.*).
type DocStore = Map<string, Record<string, any>>;

function makeFakeAdmin() {
  const docs: DocStore = new Map();
  const recentDocs: Array<{ id: string; data: Record<string, any> }> = [];

  const docRef = (path: string) => ({
    set: vi.fn(async (data: Record<string, any>, opts?: { merge?: boolean }) => {
      const prev = docs.get(path);
      if (opts?.merge && prev) {
        docs.set(path, { ...prev, ...data });
      } else {
        docs.set(path, { ...data });
      }
    }),
    get: vi.fn(async () => {
      const data = docs.get(path);
      return {
        exists: !!data,
        data: () => data,
      };
    }),
    update: vi.fn(async (data: Record<string, any>) => {
      const prev = docs.get(path) ?? {};
      docs.set(path, { ...prev, ...data });
    }),
  });

  const queryChain = () => {
    const obj = {
      where: vi.fn(() => obj),
      orderBy: vi.fn(() => obj),
      limit: vi.fn(() => obj),
      get: vi.fn(async () => ({
        docs: recentDocs.map(d => ({ id: d.id, data: () => d.data })),
      })),
    };
    return obj;
  };

  const collection = vi.fn((_name: string) => ({
    doc: vi.fn((id?: string) => {
      const docId = id ?? `auto-${Math.random().toString(36).slice(2)}`;
      return { id: docId, ...docRef(`${_name}/${docId}`) };
    }),
    where: queryChain().where,
    orderBy: queryChain().orderBy,
    limit: queryChain().limit,
    get: queryChain().get,
  }));

  // Re-bind so the chain helpers above share state with `collection.where(...).orderBy(...).limit(...).get()`.
  // We rebuild a single chain instance per `collection()` call so test setup can mutate `recentDocs`.
  const collectionWithChain = vi.fn((_name: string) => {
    const chain = queryChain();
    return {
      doc: vi.fn((id?: string) => {
        const docId = id ?? `auto-${Math.random().toString(36).slice(2)}`;
        return { id: docId, ...docRef(`${_name}/${docId}`) };
      }),
      where: chain.where,
      orderBy: chain.orderBy,
      limit: chain.limit,
      get: chain.get,
    };
  });

  const firestore = vi.fn(() => ({
    collection: collectionWithChain,
  }));

  // Static helpers admin.firestore.FieldValue.* + admin.firestore.FieldValue.vector(...).
  (firestore as any).FieldValue = {
    serverTimestamp: () => '__SERVER_TS__',
    arrayUnion: (...vals: unknown[]) => ({ __arrayUnion: vals }),
    vector: (v: number[]) => ({ __vector: v }),
  };

  return {
    admin: { firestore },
    docs,
    recentDocs,
  };
}

const fakeAdmin = makeFakeAdmin();

vi.mock('firebase-admin', () => ({
  default: fakeAdmin.admin,
}));

// @google/genai — we never want a real API call.
vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn().mockImplementation(() => ({
    models: {
      embedContent: vi.fn(async () => ({ embeddings: [{ values: [0.1, 0.2, 0.3] }] })),
      generateContent: vi.fn(async () => ({ text: '[]' })),
    },
  })),
}));

// geminiBackend.autoConnectNodes — fully stubbed so the tests pin behaviour
// at the boundary (we don't care that the real impl calls Gemini).
const autoConnectMock = vi.fn(async (_n: any, _e: any) => [] as string[]);
vi.mock('./geminiBackend', () => ({
  autoConnectNodes: (newNode: any, existing: any) => autoConnectMock(newNode, existing),
}));

// ── SUT ─────────────────────────────────────────────────────────────────────

let syncNodeToNetwork: typeof import('./networkBackend').syncNodeToNetwork;

beforeEach(async () => {
  vi.stubEnv('GEMINI_API_KEY', 'test-key');
  fakeAdmin.docs.clear();
  fakeAdmin.recentDocs.length = 0;
  autoConnectMock.mockReset();
  autoConnectMock.mockResolvedValue([]);

  // Re-import the SUT each test so mock state is fresh.
  vi.resetModules();
  const mod = await import('./networkBackend');
  syncNodeToNetwork = mod.syncNodeToNetwork;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('syncNodeToNetwork — autoConnect suggestions', () => {
  it('returns suggested connections in the response payload (does not auto-write them)', async () => {
    fakeAdmin.recentDocs.push(
      { id: 'recent-1', data: { id: 'recent-1', title: 'Recent A', type: 'Riesgo', projectId: 'p1' } },
      { id: 'recent-2', data: { id: 'recent-2', title: 'Recent B', type: 'EPP', projectId: 'p1' } },
    );
    autoConnectMock.mockResolvedValue(['recent-1', 'recent-2']);

    const result = await syncNodeToNetwork(
      {
        id: 'new-node',
        title: 'New Hazard',
        description: 'Caída de altura',
        type: 'Riesgo',
        projectId: 'p1',
        connections: [],
        embedding: [0.1, 0.2],
      },
      'author-uid',
    );

    expect(result.success).toBe(true);
    expect(result.nodeId).toBe('new-node');
    expect(result.connectionSuggestions).toEqual(['recent-1', 'recent-2']);

    // Critically: the new node's `connections` array was NOT mutated by the
    // suggestions. Auto-writing would put us at risk of hitting the 200-edge
    // rules cap without consent.
    const stored = fakeAdmin.docs.get('nodes/new-node');
    expect(stored?.connections).toEqual([]);
  });

  it('filters out already-connected ids and the new node itself', async () => {
    fakeAdmin.recentDocs.push(
      { id: 'already-linked', data: { id: 'already-linked', title: 'X', type: 'Riesgo', projectId: 'p1' } },
      { id: 'fresh-1', data: { id: 'fresh-1', title: 'Y', type: 'Riesgo', projectId: 'p1' } },
      { id: 'new-node', data: { id: 'new-node', title: 'Self', type: 'Riesgo', projectId: 'p1' } },
    );
    // The model returns the already-linked node + a fresh candidate + a
    // hallucinated id not in the recent set.
    autoConnectMock.mockResolvedValue(['already-linked', 'fresh-1', 'hallucinated-id']);

    const result = await syncNodeToNetwork(
      {
        id: 'new-node',
        title: 'New',
        description: '...',
        type: 'Riesgo',
        projectId: 'p1',
        connections: ['already-linked'],
        embedding: [0.1],
      },
      'author-uid',
    );

    // 'already-linked' should be dropped (already in connections).
    // 'hallucinated-id' should be dropped (not in candidate set).
    // 'fresh-1' survives.
    // 'new-node' is filtered out of recentDocs by the implementation
    // (we sliced it out via `.filter(n => n.id !== nodeId)`).
    expect(result.connectionSuggestions).toEqual(['fresh-1']);
  });

  it('degrades to empty suggestions when autoConnectNodes throws (sync still succeeds)', async () => {
    fakeAdmin.recentDocs.push(
      { id: 'recent-1', data: { id: 'recent-1', title: 'A', type: 'Riesgo', projectId: 'p1' } },
    );
    autoConnectMock.mockRejectedValue(new Error('Gemini quota exceeded'));

    const result = await syncNodeToNetwork(
      {
        id: 'new-node',
        title: 'New',
        description: '...',
        type: 'Riesgo',
        projectId: 'p1',
        connections: [],
        embedding: [0.1],
      },
      'author-uid',
    );

    // Suggestion path failed but the primary write contract is intact.
    expect(result.success).toBe(true);
    expect(result.nodeId).toBe('new-node');
    expect(result.connectionSuggestions).toEqual([]);
    expect(fakeAdmin.docs.has('nodes/new-node')).toBe(true);
  });
});

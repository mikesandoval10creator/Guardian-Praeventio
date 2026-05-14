import { describe, it, expect, vi } from 'vitest';
import {
  createZkFirebaseReadAdapter,
  type AdminDocLike,
  type AdminFirestoreLike,
  type AdminQuerySnapshot,
} from './zkFirebaseReadAdapter';

// ────────────────────────────────────────────────────────────────────────
// Mini in-memory Firestore mock
// ────────────────────────────────────────────────────────────────────────

interface FakeNode {
  id: string;
  data: Record<string, unknown>;
}

function makeFakeFirestore(seed: Record<string, FakeNode[]>): AdminFirestoreLike {
  // Map<tenantId, Map<nodeId, FakeNode>>
  const byTenant = new Map<string, Map<string, FakeNode>>();
  for (const [tid, nodes] of Object.entries(seed)) {
    const m = new Map<string, FakeNode>();
    for (const n of nodes) m.set(n.id, n);
    byTenant.set(tid, m);
  }

  function makeCollection(tenantId: string, filters: Array<[string, string, unknown]> = [], lim = Infinity) {
    const m = byTenant.get(tenantId) ?? new Map();
    const baseCollection: any = {
      doc(id: string): AdminDocLike {
        return {
          id,
          get: async () => {
            const node = m.get(id);
            return {
              id,
              exists: !!node,
              data: () => node?.data,
            };
          },
          collection(_path: string) {
            // For nested .collection('zettelkasten_nodes') we redirect
            // back to the tenant's flat map.
            return makeCollection(tenantId);
          },
        };
      },
      where(field: string, op: string, value: unknown) {
        return makeCollection(tenantId, [...filters, [field, op, value]], lim);
      },
      limit(n: number) {
        return makeCollection(tenantId, filters, n);
      },
      async get(): Promise<AdminQuerySnapshot> {
        const all = Array.from(m.values()).filter((n) =>
          filters.every(([field, _op, val]) => n.data[field] === val),
        );
        const sliced = all.slice(0, lim);
        return {
          docs: sliced.map((n) => ({
            id: n.id,
            exists: true,
            data: () => n.data,
          })),
        };
      },
    };
    return baseCollection;
  }

  return {
    collection(path: string) {
      if (path !== 'tenants') {
        throw new Error(`fakeFirestore: unexpected root collection ${path}`);
      }
      // tenants -> doc(tid) -> collection('zettelkasten_nodes')
      return {
        doc(tenantId: string): AdminDocLike {
          return {
            id: tenantId,
            get: async () => ({ id: tenantId, exists: true, data: () => ({}) }),
            collection(name: string) {
              if (name !== 'zettelkasten_nodes') {
                throw new Error(`fakeFirestore: unexpected subcollection ${name}`);
              }
              return makeCollection(tenantId);
            },
          };
        },
        where: () => {
          throw new Error('not supported on root');
        },
        limit: () => {
          throw new Error('not supported on root');
        },
        get: async () => ({ docs: [] }),
      };
    },
  };
}

const tenantA = 'tenant-a';
const tenantB = 'tenant-b';

const seed: Record<string, FakeNode[]> = {
  [tenantA]: [
    {
      id: 'n1',
      data: {
        type: 'RISK',
        title: 'Caída altura',
        description: 'Trabajo sobre 1.8m',
        tags: ['altura'],
        connections: ['n2', 'n3'],
        severity: 'critical',
        projectId: 'p1',
      },
    },
    {
      id: 'n2',
      data: {
        type: 'EPP',
        title: 'Arnés',
        description: 'Arnés de cuerpo completo',
        tags: ['altura'],
        connections: ['n1'],
        projectId: 'p1',
      },
    },
    {
      id: 'n3',
      data: {
        type: 'TRAINING',
        title: 'Curso altura',
        description: 'Capacitación 8h',
        tags: ['altura'],
        connections: ['n1', 'n4'],
        projectId: 'p1',
      },
    },
    {
      id: 'n4',
      data: {
        type: 'NORMATIVE',
        title: 'DS 594 art 36',
        description: 'Trabajo en altura',
        tags: ['normativa'],
        connections: [],
        projectId: 'p2',
      },
    },
  ],
  [tenantB]: [
    {
      id: 'b1',
      data: {
        type: 'RISK',
        title: 'Riesgo de tenant B',
        description: 'No accesible desde tenant A',
        tags: [],
        connections: [],
      },
    },
  ],
};

// ────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────

describe('zkFirebaseReadAdapter — listAccessibleTenants', () => {
  it('devuelve la whitelist provista', async () => {
    const fs = makeFakeFirestore(seed);
    const adapter = createZkFirebaseReadAdapter({
      firestore: fs,
      accessibleTenants: [tenantA, tenantB],
    });
    const list = await adapter.listAccessibleTenants();
    expect(list).toEqual([tenantA, tenantB]);
  });

  it('dedupe la whitelist', async () => {
    const fs = makeFakeFirestore(seed);
    const adapter = createZkFirebaseReadAdapter({
      firestore: fs,
      accessibleTenants: [tenantA, tenantA, tenantB, tenantB],
    });
    const list = await adapter.listAccessibleTenants();
    expect(list).toEqual([tenantA, tenantB]);
  });
});

describe('zkFirebaseReadAdapter — getNode', () => {
  it('devuelve el nodo del tenant correcto', async () => {
    const fs = makeFakeFirestore(seed);
    const adapter = createZkFirebaseReadAdapter({
      firestore: fs,
      accessibleTenants: [tenantA],
    });
    const n = await adapter.getNode(tenantA, 'n1');
    expect(n).not.toBeNull();
    expect(n!.id).toBe('n1');
    expect(n!.title).toBe('Caída altura');
    expect(n!.connections).toEqual(['n2', 'n3']);
  });

  it('tenant no en whitelist → throw', async () => {
    const fs = makeFakeFirestore(seed);
    const adapter = createZkFirebaseReadAdapter({
      firestore: fs,
      accessibleTenants: [tenantA],
    });
    await expect(adapter.getNode(tenantB, 'b1')).rejects.toThrow(
      /not in accessible list/,
    );
  });

  it('nodo no existe → null', async () => {
    const fs = makeFakeFirestore(seed);
    const adapter = createZkFirebaseReadAdapter({
      firestore: fs,
      accessibleTenants: [tenantA],
    });
    const n = await adapter.getNode(tenantA, 'does-not-exist');
    expect(n).toBeNull();
  });

  it('datos faltantes → defaults seguros', async () => {
    const fs = makeFakeFirestore({
      [tenantA]: [{ id: 'sparse', data: {} }],
    });
    const adapter = createZkFirebaseReadAdapter({
      firestore: fs,
      accessibleTenants: [tenantA],
    });
    const n = await adapter.getNode(tenantA, 'sparse');
    expect(n).not.toBeNull();
    expect(n!.type).toBe('UNKNOWN');
    expect(n!.tags).toEqual([]);
    expect(n!.connections).toEqual([]);
  });
});

describe('zkFirebaseReadAdapter — listNodes', () => {
  it('lista sin filtros aplica cap default 100', async () => {
    const fs = makeFakeFirestore(seed);
    const adapter = createZkFirebaseReadAdapter({
      firestore: fs,
      accessibleTenants: [tenantA],
    });
    const r = await adapter.listNodes(tenantA, {});
    expect(r.length).toBeLessThanOrEqual(100);
    expect(r.length).toBe(4); // los 4 del seed
  });

  it('filtro por projectId', async () => {
    const fs = makeFakeFirestore(seed);
    const adapter = createZkFirebaseReadAdapter({
      firestore: fs,
      accessibleTenants: [tenantA],
    });
    const r = await adapter.listNodes(tenantA, { projectId: 'p1' });
    expect(r.every((n) => n.projectId === 'p1')).toBe(true);
    expect(r).toHaveLength(3);
  });

  it('filtro por type', async () => {
    const fs = makeFakeFirestore(seed);
    const adapter = createZkFirebaseReadAdapter({
      firestore: fs,
      accessibleTenants: [tenantA],
    });
    const r = await adapter.listNodes(tenantA, { type: 'NORMATIVE' });
    expect(r).toHaveLength(1);
    expect(r[0]!.id).toBe('n4');
  });

  it('filtro por severity', async () => {
    const fs = makeFakeFirestore(seed);
    const adapter = createZkFirebaseReadAdapter({
      firestore: fs,
      accessibleTenants: [tenantA],
    });
    const r = await adapter.listNodes(tenantA, { severity: 'critical' });
    expect(r).toHaveLength(1);
    expect(r[0]!.id).toBe('n1');
  });

  it('limit respeta cap del adapter (maxListNodes)', async () => {
    const fs = makeFakeFirestore(seed);
    const adapter = createZkFirebaseReadAdapter({
      firestore: fs,
      accessibleTenants: [tenantA],
      maxListNodes: 2,
    });
    const r = await adapter.listNodes(tenantA, { limit: 50 });
    // Aunque user pidió 50, cap 2 aplica.
    expect(r).toHaveLength(2);
  });

  it('tenant no autorizado → throw', async () => {
    const fs = makeFakeFirestore(seed);
    const adapter = createZkFirebaseReadAdapter({
      firestore: fs,
      accessibleTenants: [tenantA],
    });
    await expect(adapter.listNodes(tenantB, {})).rejects.toThrow();
  });
});

describe('zkFirebaseReadAdapter — expandSubgraph', () => {
  it('depth=0 → solo el root', async () => {
    const fs = makeFakeFirestore(seed);
    const adapter = createZkFirebaseReadAdapter({
      firestore: fs,
      accessibleTenants: [tenantA],
    });
    const r = await adapter.expandSubgraph(tenantA, 'n1', 0);
    expect(r).toHaveLength(1);
    expect(r[0]!.id).toBe('n1');
  });

  it('depth=1 → root + neighbors directos', async () => {
    const fs = makeFakeFirestore(seed);
    const adapter = createZkFirebaseReadAdapter({
      firestore: fs,
      accessibleTenants: [tenantA],
    });
    const r = await adapter.expandSubgraph(tenantA, 'n1', 1);
    const ids = r.map((n) => n.id).sort();
    // n1 → n2, n3
    expect(ids).toEqual(['n1', 'n2', 'n3']);
  });

  it('depth=2 → expande otro nivel', async () => {
    const fs = makeFakeFirestore(seed);
    const adapter = createZkFirebaseReadAdapter({
      firestore: fs,
      accessibleTenants: [tenantA],
    });
    const r = await adapter.expandSubgraph(tenantA, 'n1', 2);
    const ids = r.map((n) => n.id).sort();
    // n1 → n2, n3; n3 → n4
    expect(ids).toEqual(['n1', 'n2', 'n3', 'n4']);
  });

  it('depth capado a 5 (anti-runaway)', async () => {
    const fs = makeFakeFirestore(seed);
    const adapter = createZkFirebaseReadAdapter({
      firestore: fs,
      accessibleTenants: [tenantA],
    });
    // Aunque pidamos 100, internamente cap a 5.
    const r = await adapter.expandSubgraph(tenantA, 'n1', 100);
    // 5 niveles BFS sobre nuestro seed devuelve los 4 nodos.
    expect(r.length).toBeGreaterThanOrEqual(4);
  });

  it('maxSubgraphNodes corta la expansión', async () => {
    const fs = makeFakeFirestore(seed);
    const adapter = createZkFirebaseReadAdapter({
      firestore: fs,
      accessibleTenants: [tenantA],
      maxSubgraphNodes: 2,
    });
    const r = await adapter.expandSubgraph(tenantA, 'n1', 5);
    expect(r.length).toBeLessThanOrEqual(2);
  });

  it('root no existe → array vacío', async () => {
    const fs = makeFakeFirestore(seed);
    const adapter = createZkFirebaseReadAdapter({
      firestore: fs,
      accessibleTenants: [tenantA],
    });
    const r = await adapter.expandSubgraph(tenantA, 'no-existe', 3);
    expect(r).toEqual([]);
  });

  it('tenant no autorizado → throw', async () => {
    const fs = makeFakeFirestore(seed);
    const adapter = createZkFirebaseReadAdapter({
      firestore: fs,
      accessibleTenants: [tenantA],
    });
    await expect(adapter.expandSubgraph(tenantB, 'b1', 1)).rejects.toThrow();
  });

  it('depth negativo se trata como 0', async () => {
    const fs = makeFakeFirestore(seed);
    const adapter = createZkFirebaseReadAdapter({
      firestore: fs,
      accessibleTenants: [tenantA],
    });
    const r = await adapter.expandSubgraph(tenantA, 'n1', -5);
    expect(r).toHaveLength(1);
    expect(r[0]!.id).toBe('n1');
  });
});

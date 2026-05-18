// Praeventio Guard — PhotoEvidenceAdapter unit tests.
//
// In-memory Firestore stub so the suite stays hermetic.

import { describe, it, expect } from 'vitest';
import { PhotoEvidenceAdapter } from './photoEvidenceFirestoreAdapter.js';
import { buildArtifact } from './photoEvidenceEngine.js';
import type {
  EvidenceArtifact,
  EvidenceLinkage,
} from './photoEvidenceEngine.js';

const VALID_HASH = 'a'.repeat(64);
const VALID_HASH_2 = 'b'.repeat(64);

function makeArtifact(
  override: Partial<EvidenceArtifact> & { id: string },
): EvidenceArtifact {
  const base = buildArtifact({
    payload: {
      originalFilename: 'evidence.jpg',
      mimeType: 'image/jpeg',
      byteSize: 100_000,
      capturedAt: '2026-05-18T10:00:00Z',
      capturedByUid: 'worker_pedro',
    },
    contentHash: override.id ?? VALID_HASH,
    linkages: [],
    now: new Date('2026-05-18T10:00:01Z'),
  });
  return { ...base, ...override };
}

interface DocStub {
  data: Record<string, unknown> | null;
}

function makeDb() {
  // Map from collection-path → docId → doc-data
  const store = new Map<string, Map<string, DocStub>>();
  const getCol = (path: string) => {
    if (!store.has(path)) store.set(path, new Map());
    return store.get(path)!;
  };

  function makeQuery(path: string, filters: Array<(d: any) => boolean>, sortBy?: string, sortDir?: 'asc' | 'desc', limitN?: number) {
    return {
      where(field: string, op: string, value: unknown) {
        return makeQuery(
          path,
          [
            ...filters,
            (doc) => {
              const v = (doc as Record<string, unknown>)[field];
              if (op === '==') return v === value;
              if (op === 'array-contains')
                return Array.isArray(v) && v.includes(value);
              return false;
            },
          ],
          sortBy,
          sortDir,
          limitN,
        );
      },
      orderBy(field: string, dir: 'asc' | 'desc' = 'asc') {
        return makeQuery(path, filters, field, dir, limitN);
      },
      limit(n: number) {
        return makeQuery(path, filters, sortBy, sortDir, n);
      },
      async get() {
        const col = getCol(path);
        let docs = [...col.entries()]
          .map(([id, d]) => ({ id, data: d.data ?? {} }))
          .filter((doc) => filters.every((f) => f(doc.data)));
        if (sortBy) {
          docs.sort((a, b) => {
            const av = (a.data as Record<string, unknown>)[sortBy!] as string;
            const bv = (b.data as Record<string, unknown>)[sortBy!] as string;
            if (av === bv) return 0;
            return (sortDir === 'desc' ? -1 : 1) * (av < bv ? -1 : 1);
          });
        }
        if (limitN !== undefined) docs = docs.slice(0, limitN);
        return {
          docs: docs.map((d) => ({
            id: d.id,
            data: () => d.data,
          })),
        };
      },
    };
  }

  return {
    collection(path: string) {
      const col = getCol(path);
      return {
        doc(id: string) {
          return {
            async get() {
              const d = col.get(id);
              return {
                exists: !!d,
                data: () => d?.data ?? undefined,
              };
            },
            async set(
              data: Record<string, unknown>,
              opts?: { merge?: boolean },
            ) {
              const prev = col.get(id)?.data ?? null;
              if (opts?.merge && prev) {
                col.set(id, { data: { ...prev, ...data } });
              } else {
                col.set(id, { data: { ...data } });
              }
            },
          };
        },
        ...makeQuery(path, []),
      };
    },
    __store: store,
  };
}

const TENANT = 'tenant_acme';
const PROJECT = 'project_norte';

describe('PhotoEvidenceAdapter.save', () => {
  it('persists a fresh artifact under content-addressed id', async () => {
    const db = makeDb();
    const adapter = new PhotoEvidenceAdapter(db, TENANT, PROJECT);
    const artifact = makeArtifact({ id: VALID_HASH });
    await adapter.save(artifact);
    const fetched = await adapter.getById(VALID_HASH);
    expect(fetched?.id).toBe(VALID_HASH);
    expect(fetched?.originalFilename).toBe('evidence.jpg');
  });

  it('merges linkages on re-save instead of replacing', async () => {
    const db = makeDb();
    const adapter = new PhotoEvidenceAdapter(db, TENANT, PROJECT);
    const first = makeArtifact({
      id: VALID_HASH,
      linkages: [{ nodeKind: 'incident', nodeId: 'inc_1' }],
    });
    await adapter.save(first);
    // Second uploader links the same hash to a different node.
    const second = makeArtifact({
      id: VALID_HASH,
      linkages: [{ nodeKind: 'inspection', nodeId: 'insp_2' }],
    });
    await adapter.save(second);
    const fetched = await adapter.getById(VALID_HASH);
    expect(fetched?.linkages).toHaveLength(2);
    expect(fetched?.linkages.map((l) => l.nodeKind).sort()).toEqual([
      'incident',
      'inspection',
    ]);
  });

  it('deduplicates identical linkages on merge', async () => {
    const db = makeDb();
    const adapter = new PhotoEvidenceAdapter(db, TENANT, PROJECT);
    const link: EvidenceLinkage = { nodeKind: 'incident', nodeId: 'inc_1' };
    await adapter.save(makeArtifact({ id: VALID_HASH, linkages: [link] }));
    await adapter.save(makeArtifact({ id: VALID_HASH, linkages: [link] }));
    const fetched = await adapter.getById(VALID_HASH);
    expect(fetched?.linkages).toHaveLength(1);
  });
});

describe('PhotoEvidenceAdapter.appendLinkage', () => {
  it('adds a new linkage atomically', async () => {
    const db = makeDb();
    const adapter = new PhotoEvidenceAdapter(db, TENANT, PROJECT);
    await adapter.save(
      makeArtifact({
        id: VALID_HASH,
        linkages: [{ nodeKind: 'incident', nodeId: 'inc_1' }],
      }),
    );
    await adapter.appendLinkage(VALID_HASH, {
      nodeKind: 'audit',
      nodeId: 'aud_99',
    });
    const fetched = await adapter.getById(VALID_HASH);
    expect(fetched?.linkages.map((l) => l.nodeId).sort()).toEqual([
      'aud_99',
      'inc_1',
    ]);
  });

  it('does nothing when artifact does not exist (no throw)', async () => {
    const db = makeDb();
    const adapter = new PhotoEvidenceAdapter(db, TENANT, PROJECT);
    await expect(
      adapter.appendLinkage('nonexistent', {
        nodeKind: 'audit',
        nodeId: 'aud_1',
      }),
    ).resolves.toBeUndefined();
  });

  it('updates linkageKeys array-contains projection', async () => {
    const db = makeDb();
    const adapter = new PhotoEvidenceAdapter(db, TENANT, PROJECT);
    await adapter.save(
      makeArtifact({
        id: VALID_HASH,
        linkages: [{ nodeKind: 'incident', nodeId: 'inc_1' }],
      }),
    );
    await adapter.appendLinkage(VALID_HASH, {
      nodeKind: 'audit',
      nodeId: 'aud_42',
    });
    // listForNode uses linkageKeys array-contains, so the new linkage
    // must be reachable through that query path.
    const fetched = await adapter.listForNode('audit', 'aud_42');
    expect(fetched).toHaveLength(1);
    expect(fetched[0]?.id).toBe(VALID_HASH);
  });
});

describe('PhotoEvidenceAdapter.listForNode', () => {
  it('returns artifacts linked to the requested node', async () => {
    const db = makeDb();
    const adapter = new PhotoEvidenceAdapter(db, TENANT, PROJECT);
    const a = makeArtifact({
      id: VALID_HASH,
      capturedAt: '2026-05-18T10:00:00Z',
    });
    a.linkages = [{ nodeKind: 'incident', nodeId: 'inc_target' }];
    // Save also writes linkageKeys to match the array-contains query.
    a.linkages.push({ nodeKind: 'audit', nodeId: 'aud_x' });
    const aWithKeys = {
      ...a,
      linkageKeys: a.linkages.map((l) => `${l.nodeKind}:${l.nodeId}`),
    };
    await db
      .collection(`tenants/${TENANT}/projects/${PROJECT}/photo_evidence`)
      .doc(a.id)
      .set(aWithKeys);
    const fetched = await adapter.listForNode('incident', 'inc_target');
    expect(fetched).toHaveLength(1);
    expect(fetched[0]?.id).toBe(VALID_HASH);
  });

  it('orders by capturedAt desc and respects limit', async () => {
    const db = makeDb();
    const adapter = new PhotoEvidenceAdapter(db, TENANT, PROJECT);
    const docs = [
      { id: VALID_HASH, capturedAt: '2026-05-18T10:00:00Z' },
      { id: VALID_HASH_2, capturedAt: '2026-05-18T12:00:00Z' },
    ];
    for (const d of docs) {
      const a = makeArtifact({
        id: d.id,
        capturedAt: d.capturedAt,
        linkages: [{ nodeKind: 'incident', nodeId: 'inc_common' }],
      });
      const withKeys = { ...a, linkageKeys: ['incident:inc_common'] };
      await db
        .collection(`tenants/${TENANT}/projects/${PROJECT}/photo_evidence`)
        .doc(a.id)
        .set(withKeys);
    }
    const fetched = await adapter.listForNode('incident', 'inc_common', 5);
    expect(fetched).toHaveLength(2);
    expect(fetched[0]?.id).toBe(VALID_HASH_2); // newer first
    expect(fetched[1]?.id).toBe(VALID_HASH);
  });

  it('limits results to requested page size', async () => {
    const db = makeDb();
    const adapter = new PhotoEvidenceAdapter(db, TENANT, PROJECT);
    for (let i = 0; i < 5; i++) {
      const id = String(i).padEnd(64, '0');
      const a = makeArtifact({
        id,
        capturedAt: `2026-05-18T${10 + i}:00:00Z`,
        linkages: [{ nodeKind: 'incident', nodeId: 'inc_busy' }],
      });
      const withKeys = { ...a, linkageKeys: ['incident:inc_busy'] };
      await db
        .collection(`tenants/${TENANT}/projects/${PROJECT}/photo_evidence`)
        .doc(a.id)
        .set(withKeys);
    }
    const fetched = await adapter.listForNode('incident', 'inc_busy', 3);
    expect(fetched).toHaveLength(3);
  });
});

describe('PhotoEvidenceAdapter.listForUploader', () => {
  it('returns artifacts by the specified uid only', async () => {
    const db = makeDb();
    const adapter = new PhotoEvidenceAdapter(db, TENANT, PROJECT);
    const mine = makeArtifact({
      id: VALID_HASH,
      capturedByUid: 'worker_pedro',
    });
    const theirs = makeArtifact({
      id: VALID_HASH_2,
      capturedByUid: 'worker_maria',
    });
    await adapter.save(mine);
    await adapter.save(theirs);
    const fetched = await adapter.listForUploader('worker_pedro');
    expect(fetched).toHaveLength(1);
    expect(fetched[0]?.id).toBe(VALID_HASH);
  });
});

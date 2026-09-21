// Praeventio Guard — PhotoEvidenceAdapter unit tests.
//
// In-memory Firestore stub so the suite stays hermetic.

import { describe, it, expect } from 'vitest';
import {
  PhotoEvidenceAdapter,
  type PhotoEvidenceFirestoreDb,
} from './photoEvidenceFirestoreAdapter.js';
import { buildArtifact, EvidenceArtifactNotFoundError } from './photoEvidenceEngine.js';
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
        // [Hy3-audit] Resolves [Audit-2026-08-31] PhotoEvidenceAdapter —
        // merge read-then-set puede perder linkages concurrentes.
        // Exposes a single-call runTransaction that mirrors the
        // contract the adapter now relies on. The body runs
        // synchronously inside the transaction; the fake is
        // single-threaded so the read+update sequence is atomic
        // from the caller's perspective. Production goes through
        // Firestore's actual runTransaction (snapshot-isolated).
        async runTransaction<T>(fn: (txn: {
          get: (ref: {
            get: () => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>;
          }) => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>;
          update: (ref: {
            set: (data: Record<string, unknown>, opts?: { merge?: boolean }) => Promise<void>;
          }, data: Record<string, unknown>) => Promise<void>;
        }) => Promise<T>): Promise<T> {
          // Delegate txn.get / txn.update to the doc ref's existing
          // get / set methods. The fake serializes the body (JS is
          // single-threaded), so read+update appears atomic from
          // the caller's perspective. Production runs inside
          // Firestore's real runTransaction with snapshot
          // isolation.
          return fn({
            async get(ref) {
              return ref.get();
            },
            async update(ref, data) {
              await ref.set(data, { merge: true });
            },
          });
        },
        ...makeQuery(path, []),
      };
    },
    __store: store,
  // [Hy3-audit] Resolves [Audit-2026-08-31] PhotoEvidenceAdapter —
  // merge read-then-set puede perder linkages concurrentes. The test
  // fake intentionally satisfies the contract surface that the adapter
  // uses (doc + runTransaction + the legacy read-modify-write path);
  // the cast documents the boundary between the typed contract and
  // the duck-typed implementation. The fake in-memory runTransaction
  // is a single-call delegate that body-runs synchronously; the
  // production Firestore Admin SDK implements runTransaction with
  // snapshot isolation (true OCC).
  } as unknown as PhotoEvidenceFirestoreDb;
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

  // [Hy3-audit] Resolves [Audit-2026-08-31] PhotoEvidence linkage —
  // artifact inexistente devuelve 204. Previously this method
  // silently returned when the artifact did not exist (the legacy
  // "does nothing (no throw)" semantics); the route then returned
  // HTTP 204 and the client interpreted success. Now the adapter
  // throws EvidenceArtifactNotFoundError so the handler can map to
  // HTTP 404 — a misleading silent success is worse than a 404.
  it('throws EvidenceArtifactNotFoundError when artifact does not exist', async () => {
    const db = makeDb();
    const adapter = new PhotoEvidenceAdapter(db, TENANT, PROJECT);
    await expect(
      adapter.appendLinkage('nonexistent', {
        nodeKind: 'audit',
        nodeId: 'aud_1',
      }),
    ).rejects.toBeInstanceOf(EvidenceArtifactNotFoundError);
    // The artifact must NOT have been created as a side effect of the
    // throw — the throw happens before any write.
    const fetched = await adapter.getById('nonexistent');
    expect(fetched).toBeNull();
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

  // [Hy3-audit] Resolves [Audit-2026-08-31] PhotoEvidenceAdapter —
  // merge read-then-set puede perder linkages concurrentes. The legacy
  // adapter used `ref.get` then `ref.set({merge:true})` outside any
  // transaction, so two concurrent appendLinkage calls could each
  // read the same snapshot and the second write would clobber the
  // first's linkage. After the fix, `appendLinkage` goes through
  // `runTransaction`, which the production Firestore Admin SDK
  // implements with snapshot isolation.
  //
  // This test is a structural pin: it verifies the adapter uses
  // `runTransaction` rather than a raw read-modify-write. A future
  // regression to the legacy path would either fail to use
  // runTransaction (this test catches it via the spy) or
  // re-introduce the lost-update risk on production.
  it('uses runTransaction for atomic appendLinkage (no lost-update race)', async () => {
    let txnInvoked = 0;
    const db = makeDb();
    const dbWithSpy = {
      collection(path: string) {
        const original = db.collection(path);
        // CRITICAL: spread BEFORE defining runTransaction. If we
        // defined runTransaction BEFORE the spread, the spread of
        // `original.runTransaction` would OVERWRITE the spy and the
        // counter would never increment. Defining the spy AFTER the
        // spread keeps the spy sticky.
        return {
          // Pass-through everything the adapter uses for collection()
          // callers (doc, get-by-path, the makeQuery surface). The
          // adapter ONLY needs `doc` and `runTransaction` from this
          // collection; the other keys are forward-compatibility for
          // future tests.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ...(original as any),
          doc: original.doc.bind(original),
          // Spy-decorated runTransaction: increments the counter on
          // every entry so the test can assert "appendLinkage went
          // through the atomic path". The body delegates to the
          // real fake-Db transaction implementation so the
          // read-modify-update logic still runs.
          async runTransaction<T>(fn: (txn: unknown) => Promise<T>): Promise<T> {
            txnInvoked++;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return (original as any).runTransaction(fn);
          },
        };
      },
    };
    const adapter = new PhotoEvidenceAdapter(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      dbWithSpy as any,
      TENANT,
      PROJECT,
    );
    await adapter.save(
      makeArtifact({
        id: VALID_HASH,
        linkages: [],
      }),
    );
    // Two sequential appends — each must go through runTransaction.
    await adapter.appendLinkage(VALID_HASH, {
      nodeKind: 'incident',
      nodeId: 'inc_A',
    });
    await adapter.appendLinkage(VALID_HASH, {
      nodeKind: 'inspection',
      nodeId: 'insp_B',
    });
    expect(txnInvoked).toBe(2);
    const fetched = await adapter.getById(VALID_HASH);
    expect(fetched?.linkages.map((l) => l.nodeId).sort()).toEqual([
      'inc_A',
      'insp_B',
    ]);
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

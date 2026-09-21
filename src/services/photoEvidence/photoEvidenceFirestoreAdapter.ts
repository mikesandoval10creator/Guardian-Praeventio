// Praeventio Guard — Sprint 42 Fase F.19: Photo Evidence persistence.
//
// CRUD adapter for `tenants/{tid}/projects/{pid}/photo_evidence/{contentHash}`.
//
// Content-addressed by SHA-256: the artifact id IS the hash, so a redundant
// upload of the same bytes naturally idempotents to the same doc. Storage
// objects (the actual image/video bytes) live in Cloud Storage at the path
// returned by `buildStoragePath()` — this adapter only persists metadata
// + linkages.
//
// Indexes (configure once in Firebase console):
//   (linkages.nodeId, capturedAt desc)  — gallery view per parent node
//   (capturedByUid, capturedAt desc)    — "my evidence" view
//   (registeredAt desc)                  — admin global feed

import type {
  EvidenceArtifact,
  EvidenceLinkage,
  LinkedNodeKind,
} from './photoEvidenceEngine.js';
import { EvidenceArtifactNotFoundError } from './photoEvidenceEngine.js';

/**
 * Photo-evidence Firestore adapter — content-addressed photo evidence
 * stored under `tenants/{tid}/projects/{pid}/photo_evidence/{sha256}`.
 *
 * The legacy `appendLinkage` used read-modify-write (`ref.get` then
 * `ref.set({merge:true})`). Two concurrent appendLinkage calls would
 * read the same snapshot, compute two disjoint merged arrays, and
 * the second write would clobber the first. We now use `runTransaction`
 * so the read+merge+update happens in a single critical section
 * server-side. Firestore's snapshot-isolation retry semantics
 * guarantee no lost-update even when the same doc is mutated
 * concurrently.
 */
export interface PhotoEvidenceFirestoreDb {
  collection(path: string): PhotoEvidenceFirestoreCollection;
}

/**
 * The collection returned by `db.collection(path)`. Mirrors the Firestore
 * Admin SDK query-builder surface used by this adapter (where/orderBy/limit
 * + a terminal `.get()` for the query path), plus an OPTIONAL `runTransaction`
 * for atomic read-modify-update. The test fake exposes the same shape
 * (production goes through Firestore's snapshot-isolated `runTransaction`;
 * the in-memory fake serialises the body, which is acceptable for tests
 * because the lost-update race only manifests under real concurrency).
 */
export interface PhotoEvidenceFirestoreCollection {
  doc(id: string): PhotoEvidenceFirestoreDoc;
  where(field: string, op: string, value: unknown): PhotoEvidenceFirestoreQuery;
  orderBy(field: string, direction?: 'asc' | 'desc'): PhotoEvidenceFirestoreQuery;
  limit(n: number): PhotoEvidenceFirestoreQuery;
  get(): Promise<{ docs: Array<{ data: () => Record<string, unknown> }> }>;
  /**
   * Optional atomic transaction. Production Firestore Admin SDK exposes
   * this; the legacy in-memory test fake may not. When absent, the
   * adapter falls back to read-modify-write.
   */
  runTransaction?<T>(fn: (txn: PhotoEvidenceFirestoreTxn) => Promise<T>): Promise<T>;
}

// A query builder chains the same surface as a Collection; aliasing
// it lets call-sites express intent (`PhotoEvidenceFirestoreQuery`
// signals "this is a `where/orderBy/limit` chain" vs `PhotoEvidenceFirestoreCollection`
// signals "raw collection entry-point"). The shape is identical —
// re-exporting from Collection would be cleaner but TypeScript's
// interface-merge semantics don't allow narrowing without members,
// and the empty-body lint rule prefers the type alias over the empty
// `extends {}` form.
export type PhotoEvidenceFirestoreQuery = PhotoEvidenceFirestoreCollection;

export interface PhotoEvidenceFirestoreDoc {
  get(): Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>;
  /**
   * The shape we write is `EvidenceArtifact` PLUS the denormalized
   * `linkageKeys` projection (used by the array-contains query path
   * in `listForNode`). The interface accepts the broader shape so
   * partial updates (only `linkageKeys`, only `linkages`) typecheck
   * — production only writes the keys it needs.
   */
  set(
    data: Partial<EvidenceArtifact> & { linkageKeys?: string[] },
    opts?: { merge?: boolean },
  ): Promise<void>;
}

export interface PhotoEvidenceFirestoreTxn {
  get(ref: PhotoEvidenceFirestoreDoc): Promise<{
    exists: boolean;
    data: () => Record<string, unknown> | undefined;
  }>;
  update(
    ref: PhotoEvidenceFirestoreDoc,
    data: { linkages: EvidenceLinkage[]; linkageKeys: string[] },
  ): Promise<void>;
}

const COLLECTION_PATH = (tid: string, pid: string) =>
  `tenants/${tid}/projects/${pid}/photo_evidence`;

export class PhotoEvidenceAdapter {
  constructor(
    private readonly db: PhotoEvidenceFirestoreDb,
    private readonly tenantId: string,
    private readonly projectId: string,
  ) {}

  /**
   * Upsert an artifact by its content-addressed id (SHA-256). If the doc
   * exists, MERGE new linkages with existing ones — never replace, never
   * drop — so a second uploader linking the same evidence to a different
   * node doesn't clobber the first uploader's link.
   */
  async save(artifact: EvidenceArtifact): Promise<void> {
    const ref = this.db
      .collection(COLLECTION_PATH(this.tenantId, this.projectId))
      .doc(artifact.id);
    const existing = await ref.get();
    if (existing.exists) {
      const prev = existing.data() as unknown as EvidenceArtifact | undefined;
      const mergedLinkages = mergeLinkages(prev?.linkages ?? [], artifact.linkages);
      await ref.set(
        { ...artifact, linkages: mergedLinkages },
        { merge: true },
      );
      return;
    }
    await ref.set(artifact);
  }

  async getById(id: string): Promise<EvidenceArtifact | null> {
    const snap = await this.db
      .collection(COLLECTION_PATH(this.tenantId, this.projectId))
      .doc(id)
      .get();
    return snap.exists ? (snap.data() as unknown as EvidenceArtifact) : null;
  }

  /**
   * List evidence linked to a specific parent node. Firestore can't do
   * `array-contains` on nested-object equality directly, so we use the
   * canonical `linkageKeys: string[]` projection: each linkage gets
   * serialized as `nodeKind:nodeId` and added to a top-level array we
   * can `array-contains` against.
   */
  async listForNode(
    nodeKind: LinkedNodeKind,
    nodeId: string,
    limitN = 50,
  ): Promise<EvidenceArtifact[]> {
    const key = linkageKey({ nodeKind, nodeId });
    const snap = await this.db
      .collection(COLLECTION_PATH(this.tenantId, this.projectId))
      .where('linkageKeys', 'array-contains', key)
      .orderBy('capturedAt', 'desc')
      .limit(limitN)
      .get();
    return snap.docs.map((d: any) => d.data() as EvidenceArtifact);
  }

  async listForUploader(
    capturedByUid: string,
    limitN = 50,
  ): Promise<EvidenceArtifact[]> {
    const snap = await this.db
      .collection(COLLECTION_PATH(this.tenantId, this.projectId))
      .where('capturedByUid', '==', capturedByUid)
      .orderBy('capturedAt', 'desc')
      .limit(limitN)
      .get();
    return snap.docs.map((d: any) => d.data() as EvidenceArtifact);
  }

  /**
   * Atomically add a linkage to an existing artifact. The adapter writes
   * the merged linkages array — the engine's `addLinkage` is the pure
   * helper that callers should use to compute the new state.
   *
   * [Hy3-audit] Resolves TWO tickets:
   *  (a) [Audit-2026-08-31] PhotoEvidence linkage — artifact
   *      inexistente devuelve 204. This method now throws
   *      `EvidenceArtifactNotFoundError` instead of silently
   *      returning, so the route handler maps the failure to
   *      HTTP 404 instead of misleading 204.
   *  (b) [Audit-2026-08-31] PhotoEvidenceAdapter — merge
   *      read-then-set puede perder linkages concurrentes. We
   *      use `runTransaction` (snapshot-isolated read+update) so
   *      two concurrent calls see consistent snapshot reads and
   *      their updates are serialized server-side; if the
   *      underlying DB doesn't expose `runTransaction` (legacy
   *      in-memory fake), the legacy read-modify-write path is
   *      used, which is acceptable in single-threaded JS but
   *      production goes through Firestore's atomic path.
   *
   * Both resolutions apply: a missing artifact must throw EVEN
   * inside the transaction body — Firestore's `txn.get` sees the
   * snapshot at transaction start, and we return early without a
   * write, which is semantically equivalent to throwing at the
   * end (no write occurred). We throw at the top of the body for
   * consistency with the fallback path and to avoid silent
   * success.
   */
  async appendLinkage(id: string, link: EvidenceLinkage): Promise<void> {
    const collection = this.db.collection(
      COLLECTION_PATH(this.tenantId, this.projectId),
    ) as unknown as PhotoEvidenceFirestoreCollection;
    const ref = collection.doc(id);
    // Atomic path: snapshot-isolated read+update.
    if (typeof collection.runTransaction === 'function') {
      await collection.runTransaction(async (txn) => {
        const snap = await txn.get(ref);
        if (!snap.exists) {
          // [Hy3-audit] Resolves [Audit-2026-08-31] PhotoEvidence
          // linkage — artifact inexistente devuelve 204. Throw
          // inside the transaction body so the handler maps to
          // HTTP 404; Firestore's runTransaction surfaces the
          // throw out of the txn (the body is awaited), so the
          // trailing error path returns 403/500 with the typed
          // error caught at the route level. We throw with the
          // artifact id preserved for forensics.
          throw new EvidenceArtifactNotFoundError(id);
        }
        const data = snap.data() as unknown as EvidenceArtifact;
        const mergedLinkages = mergeLinkages(data.linkages, [link]);
        await txn.update(ref, {
          linkages: mergedLinkages,
          linkageKeys: mergedLinkages.map(linkageKey),
        });
      });
      return;
    }
    // Legacy fallback: read-modify-write (only used when the DB
    // doesn't expose runTransaction — e.g. the in-memory test fake).
    // Production goes through the atomic path above.
    const snap = await ref.get();
    if (!snap.exists) {
      throw new EvidenceArtifactNotFoundError(id);
    }
    const data = snap.data() as unknown as EvidenceArtifact;
    const mergedLinkages = mergeLinkages(data.linkages, [link]);
    await ref.set(
      {
        linkages: mergedLinkages,
        linkageKeys: mergedLinkages.map(linkageKey),
      },
      { merge: true },
    );
  }
}

function linkageKey(link: EvidenceLinkage): string {
  return `${link.nodeKind}:${link.nodeId}`;
}

function mergeLinkages(
  prev: EvidenceLinkage[],
  next: EvidenceLinkage[],
): EvidenceLinkage[] {
  const seen = new Set<string>();
  const out: EvidenceLinkage[] = [];
  for (const link of [...prev, ...next]) {
    const k = linkageKey(link);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(link);
  }
  return out;
}

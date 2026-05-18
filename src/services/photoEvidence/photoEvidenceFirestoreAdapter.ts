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

export interface PhotoEvidenceFirestoreDb {
  collection(path: string): any;
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
      const prev = existing.data() as EvidenceArtifact | undefined;
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
    return snap.exists ? (snap.data() as EvidenceArtifact) : null;
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
   */
  async appendLinkage(id: string, link: EvidenceLinkage): Promise<void> {
    const ref = this.db
      .collection(COLLECTION_PATH(this.tenantId, this.projectId))
      .doc(id);
    const snap = await ref.get();
    if (!snap.exists) return;
    const data = snap.data() as EvidenceArtifact;
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

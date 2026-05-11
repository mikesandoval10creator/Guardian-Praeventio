// Persistence #11: custodyChainService adapter.
// Schema:
//   tenants/{tid}/evidence_artifacts/{hash}            ← content-addressed
//   tenants/{tid}/evidence_artifacts/{hash}/events/{at} ← custody log subcoll
//
// Indexes: (uploadedByUid, uploadedAt desc), (linkedNodeId), (kind, uploadedAt desc)
// Events subcollection: (at desc), (eventKind, at desc)
//
// Content-addressing: doc id = SHA-256 hash. Re-uploading identical bytes
// is naturally idempotent at the storage layer.

import type { EvidenceArtifact, CustodyEvent } from './custodyChainService.js';

export interface CustodyFirestoreDb {
  collection(path: string): any;
}

const ART_PATH = (tid: string) => `tenants/${tid}/evidence_artifacts`;
const EV_PATH = (tid: string, hash: string) =>
  `tenants/${tid}/evidence_artifacts/${hash}/events`;

export class CustodyChainAdapter {
  constructor(
    private readonly db: CustodyFirestoreDb,
    private readonly tenantId: string,
  ) {}

  /** Persist artifact metadata. Doc id = hash (content-addressed). */
  async saveArtifact(artifact: EvidenceArtifact): Promise<void> {
    await this.db.collection(ART_PATH(this.tenantId)).doc(artifact.id).set(artifact);
  }

  async getArtifact(hash: string): Promise<EvidenceArtifact | null> {
    const snap = await this.db.collection(ART_PATH(this.tenantId)).doc(hash).get();
    return snap.exists ? (snap.data() as EvidenceArtifact) : null;
  }

  async markReplaced(
    hash: string,
    replacedByHash: string,
    replacedAt: string,
  ): Promise<void> {
    await this.db
      .collection(ART_PATH(this.tenantId))
      .doc(hash)
      .update({ replacedByHash, replacedAt });
  }

  async appendEvent(event: CustodyEvent): Promise<void> {
    // event id = at ISO timestamp (assumed unique per artifact)
    await this.db
      .collection(EV_PATH(this.tenantId, event.artifactHash))
      .doc(event.at)
      .set(event);
  }

  async listEvents(hash: string, limitN = 200): Promise<CustodyEvent[]> {
    const snap = await this.db
      .collection(EV_PATH(this.tenantId, hash))
      .orderBy('at', 'desc')
      .limit(limitN)
      .get();
    return snap.docs.map((d: any) => d.data() as CustodyEvent);
  }

  async listArtifactsForNode(linkedNodeId: string, limitN = 100): Promise<EvidenceArtifact[]> {
    const snap = await this.db
      .collection(ART_PATH(this.tenantId))
      .where('linkedNodeId', '==', linkedNodeId)
      .orderBy('uploadedAt', 'desc')
      .limit(limitN)
      .get();
    return snap.docs.map((d: any) => d.data() as EvidenceArtifact);
  }
}

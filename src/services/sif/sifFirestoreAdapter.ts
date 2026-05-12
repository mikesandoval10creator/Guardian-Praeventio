// Persistence #14: SIF precursors adapter.
// Schema: tenants/{tid}/projects/{pid}/sif_precursors/{id}
// Indexes: (potential, occurredAt desc), (executiveReviewRequired, reviewedAt)

import type { SIFPrecursor, SIFPotential, SIFPrecursorKind } from './sifPrecursorClassifier.js';

export interface SIFFirestoreDb {
  collection(path: string): any;
}

export interface StoredSIFPrecursor extends SIFPrecursor {
  id: string;
  projectId: string;
  /** UID del que reportó el near-miss original. */
  reportedByUid: string;
  /** ISO-8601 del evento. */
  occurredAt: string;
  /** ISO-8601 cuando se hizo el review ejecutivo. */
  reviewedAt?: string;
  reviewedByUid?: string;
  reviewNotes?: string;
  /** Notificación al mandante. */
  notifiedMandanteAt?: string;
  notifiedMandanteByUid?: string;
}

const PATH = (tid: string, pid: string) =>
  `tenants/${tid}/projects/${pid}/sif_precursors`;

export class SIFAdapter {
  constructor(
    private readonly db: SIFFirestoreDb,
    private readonly tenantId: string,
    private readonly projectId: string,
  ) {}

  async save(precursor: StoredSIFPrecursor): Promise<void> {
    await this.db.collection(PATH(this.tenantId, this.projectId)).doc(precursor.id).set(precursor);
  }

  async getById(id: string): Promise<StoredSIFPrecursor | null> {
    const snap = await this.db.collection(PATH(this.tenantId, this.projectId)).doc(id).get();
    return snap.exists ? (snap.data() as StoredSIFPrecursor) : null;
  }

  async recordExecutiveReview(
    id: string,
    reviewedByUid: string,
    reviewedAt: string,
    reviewNotes?: string,
  ): Promise<void> {
    await this.db
      .collection(PATH(this.tenantId, this.projectId))
      .doc(id)
      .update({ reviewedByUid, reviewedAt, reviewNotes });
  }

  async recordMandanteNotification(
    id: string,
    notifiedByUid: string,
    notifiedAt: string,
  ): Promise<void> {
    await this.db
      .collection(PATH(this.tenantId, this.projectId))
      .doc(id)
      .update({
        notifiedMandanteByUid: notifiedByUid,
        notifiedMandanteAt: notifiedAt,
      });
  }

  async listByPotential(potential: SIFPotential, limitN = 50): Promise<StoredSIFPrecursor[]> {
    const snap = await this.db
      .collection(PATH(this.tenantId, this.projectId))
      .where('potential', '==', potential)
      .orderBy('occurredAt', 'desc')
      .limit(limitN)
      .get();
    return snap.docs.map((d: any) => d.data() as StoredSIFPrecursor);
  }

  async listPendingExecutiveReview(): Promise<StoredSIFPrecursor[]> {
    const snap = await this.db
      .collection(PATH(this.tenantId, this.projectId))
      .where('executiveReviewRequired', '==', true)
      .get();
    return snap.docs
      .map((d: any) => d.data() as StoredSIFPrecursor)
      .filter((p: StoredSIFPrecursor) => !p.reviewedAt);
  }

  async listByKind(kind: SIFPrecursorKind, limitN = 100): Promise<StoredSIFPrecursor[]> {
    const snap = await this.db
      .collection(PATH(this.tenantId, this.projectId))
      .where('kind', '==', kind)
      .orderBy('occurredAt', 'desc')
      .limit(limitN)
      .get();
    return snap.docs.map((d: any) => d.data() as StoredSIFPrecursor);
  }
}

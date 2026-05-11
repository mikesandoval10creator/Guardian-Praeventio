// Persistence #6: operationalChangeService adapter.
// Schema: tenants/{tid}/projects/{pid}/operational_changes/{id}
// Indexes: (effectiveFrom desc), (kind, impact), (declaredByUid, declaredAt desc)

import type { OperationalChange, ChangeKind } from './operationalChangeService.js';

export interface OperationalChangeFirestoreDb {
  collection(path: string): any;
}

const PATH = (tid: string, pid: string) =>
  `tenants/${tid}/projects/${pid}/operational_changes`;

export class OperationalChangeAdapter {
  constructor(
    private readonly db: OperationalChangeFirestoreDb,
    private readonly tenantId: string,
    private readonly projectId: string,
  ) {}

  async save(c: OperationalChange): Promise<void> {
    await this.db.collection(PATH(this.tenantId, this.projectId)).doc(c.id).set(c);
  }

  async getById(id: string): Promise<OperationalChange | null> {
    const snap = await this.db.collection(PATH(this.tenantId, this.projectId)).doc(id).get();
    return snap.exists ? (snap.data() as OperationalChange) : null;
  }

  /** Idempotente: re-ack del mismo worker no duplica. */
  async addAcknowledgment(
    changeId: string,
    workerUid: string,
    ackedAt: string,
  ): Promise<OperationalChange | null> {
    const ref = this.db.collection(PATH(this.tenantId, this.projectId)).doc(changeId);
    const snap = await ref.get();
    if (!snap.exists) return null;
    const current = snap.data() as OperationalChange;
    if (current.acknowledgments.some((a) => a.workerUid === workerUid)) return current;
    const updated: OperationalChange = {
      ...current,
      acknowledgments: [...current.acknowledgments, { workerUid, ackedAt }],
    };
    await ref.set(updated);
    return updated;
  }

  async markReverted(changeId: string, revertedAt: string, revertedReason: string): Promise<void> {
    await this.db
      .collection(PATH(this.tenantId, this.projectId))
      .doc(changeId)
      .update({ revertedAt, revertedReason });
  }

  async listRecent(kind?: ChangeKind, limitN = 50): Promise<OperationalChange[]> {
    let q = this.db.collection(PATH(this.tenantId, this.projectId));
    if (kind) q = q.where('kind', '==', kind);
    q = q.orderBy('effectiveFrom', 'desc').limit(limitN);
    const snap = await q.get();
    return snap.docs.map((d: any) => d.data() as OperationalChange);
  }
}

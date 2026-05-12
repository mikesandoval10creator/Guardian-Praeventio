// Persistence #22: annual SGI review adapter (PreventiveObjective).
// Schema: tenants/{tid}/preventive_objectives/{id}
// Indexes: (fiscalYear, status), (ownerUid, fiscalYear), (status, deadline)

import type { PreventiveObjective } from './annualSgiReview.js';

export interface ObjectivesFirestoreDb {
  collection(path: string): any;
}

const PATH = (tid: string) => `tenants/${tid}/preventive_objectives`;

export class PreventiveObjectivesAdapter {
  constructor(
    private readonly db: ObjectivesFirestoreDb,
    private readonly tenantId: string,
  ) {}

  async save(obj: PreventiveObjective): Promise<void> {
    await this.db.collection(PATH(this.tenantId)).doc(obj.id).set(obj);
  }

  async getById(id: string): Promise<PreventiveObjective | null> {
    const snap = await this.db.collection(PATH(this.tenantId)).doc(id).get();
    return snap.exists ? (snap.data() as PreventiveObjective) : null;
  }

  async updateProgress(
    id: string,
    currentValue: number,
    status?: PreventiveObjective['status'],
  ): Promise<void> {
    const patch: Record<string, unknown> = { currentValue };
    if (status) patch.status = status;
    await this.db.collection(PATH(this.tenantId)).doc(id).update(patch);
  }

  async listByFiscalYear(fiscalYear: number): Promise<PreventiveObjective[]> {
    const snap = await this.db
      .collection(PATH(this.tenantId))
      .where('fiscalYear', '==', fiscalYear)
      .get();
    return snap.docs.map((d: any) => d.data() as PreventiveObjective);
  }

  async listForOwner(
    ownerUid: string,
    fiscalYear?: number,
  ): Promise<PreventiveObjective[]> {
    let q = this.db.collection(PATH(this.tenantId)).where('ownerUid', '==', ownerUid);
    if (fiscalYear !== undefined) q = q.where('fiscalYear', '==', fiscalYear);
    const snap = await q.get();
    return snap.docs.map((d: any) => d.data() as PreventiveObjective);
  }

  async addLinkedAction(objectiveId: string, actionId: string): Promise<void> {
    const ref = this.db.collection(PATH(this.tenantId)).doc(objectiveId);
    const snap = await ref.get();
    if (!snap.exists) return;
    const obj = snap.data() as PreventiveObjective;
    if (obj.linkedActionIds.includes(actionId)) return;
    await ref.update({ linkedActionIds: [...obj.linkedActionIds, actionId] });
  }

  async addEvidence(objectiveId: string, evidenceUrl: string): Promise<void> {
    const ref = this.db.collection(PATH(this.tenantId)).doc(objectiveId);
    const snap = await ref.get();
    if (!snap.exists) return;
    const obj = snap.data() as PreventiveObjective;
    if (obj.evidenceUrls.includes(evidenceUrl)) return;
    await ref.update({ evidenceUrls: [...obj.evidenceUrls, evidenceUrl] });
  }
}

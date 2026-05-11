// Persistence #7: shiftHandoverService adapter.
// Schema: tenants/{tid}/projects/{pid}/shifts/{id}
// Indexes: (supervisorUid, startedAt desc), (kind, startedAt desc), (endedAt, acknowledgedAt)

import type { ShiftRecord, ShiftKind } from './shiftHandoverService.js';

export interface ShiftFirestoreDb {
  collection(path: string): any;
}

const PATH = (tid: string, pid: string) =>
  `tenants/${tid}/projects/${pid}/shifts`;

export class ShiftHandoverAdapter {
  constructor(
    private readonly db: ShiftFirestoreDb,
    private readonly tenantId: string,
    private readonly projectId: string,
  ) {}

  async save(shift: ShiftRecord): Promise<void> {
    await this.db.collection(PATH(this.tenantId, this.projectId)).doc(shift.id).set(shift);
  }

  async getById(id: string): Promise<ShiftRecord | null> {
    const snap = await this.db.collection(PATH(this.tenantId, this.projectId)).doc(id).get();
    return snap.exists ? (snap.data() as ShiftRecord) : null;
  }

  async listForSupervisor(supervisorUid: string, limitN = 30): Promise<ShiftRecord[]> {
    const snap = await this.db
      .collection(PATH(this.tenantId, this.projectId))
      .where('supervisorUid', '==', supervisorUid)
      .orderBy('startedAt', 'desc')
      .limit(limitN)
      .get();
    return snap.docs.map((d: any) => d.data() as ShiftRecord);
  }

  /** Turnos cerrados sin reconocer del entrante. */
  async listUnacknowledged(kind?: ShiftKind): Promise<ShiftRecord[]> {
    let q = this.db.collection(PATH(this.tenantId, this.projectId));
    if (kind) q = q.where('kind', '==', kind);
    const snap = await q.get();
    return snap.docs
      .map((d: any) => d.data() as ShiftRecord)
      .filter((s: ShiftRecord) => !!s.endedAt && !s.acknowledgedAt);
  }
}

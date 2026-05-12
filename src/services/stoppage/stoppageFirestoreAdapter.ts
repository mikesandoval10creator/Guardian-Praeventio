// Praeventio Guard — Sprint 39 Persistence Layer #3: stoppageEngine adapter.
//
// Schema: tenants/{tid}/projects/{pid}/stoppages/{id}
// Indexes: (status, declaredAt desc), (scopeTargetId, status)
// Rules: declare/resume requieren role superior; resumePreconditions
//        actualizables solo en status='active'|'pending_resumption'.

import type { Stoppage, StoppageStatus } from './stoppageEngine.js';

export interface StoppageFirestoreDb {
  collection(path: string): {
    doc(id: string): {
      get(): Promise<{ exists: boolean; data(): any }>;
      set(data: any): Promise<void>;
      update(patch: any): Promise<void>;
    };
    where(field: string, op: '==' | '>=' | '<=', value: any): any;
    orderBy(field: string, dir: 'asc' | 'desc'): any;
    limit(n: number): any;
  };
}

const PATH = (tid: string, pid: string) => `tenants/${tid}/projects/${pid}/stoppages`;

export class StoppageAdapter {
  constructor(
    private readonly db: StoppageFirestoreDb,
    private readonly tenantId: string,
    private readonly projectId: string,
  ) {}

  async save(stoppage: Stoppage): Promise<void> {
    await this.db
      .collection(PATH(this.tenantId, this.projectId))
      .doc(stoppage.id)
      .set(this.toFirestore(stoppage));
  }

  async getById(id: string): Promise<Stoppage | null> {
    const snap = await this.db.collection(PATH(this.tenantId, this.projectId)).doc(id).get();
    return snap.exists ? (snap.data() as Stoppage) : null;
  }

  async update(id: string, patch: Partial<Stoppage>): Promise<void> {
    await this.db.collection(PATH(this.tenantId, this.projectId)).doc(id).update(patch);
  }

  async listByStatus(status: StoppageStatus): Promise<Stoppage[]> {
    const q = this.db
      .collection(PATH(this.tenantId, this.projectId))
      .where('status', '==', status)
      .orderBy('declaredAt', 'desc')
      .limit(100);
    const snap = await q.get();
    return snap.docs.map((d: any) => d.data() as Stoppage);
  }

  private toFirestore(s: Stoppage): Record<string, any> {
    return { ...s };
  }
}

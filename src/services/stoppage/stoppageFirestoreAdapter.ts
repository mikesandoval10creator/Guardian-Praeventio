// Praeventio Guard — Sprint 39 Persistence Layer #3: stoppageEngine adapter.
//
// Schema: tenants/{tid}/projects/{pid}/stoppages/{id}
// Indexes: (status, declaredAt desc), (scopeTargetId, status)
// Rules: declare/resume requieren role superior; resumePreconditions
//        actualizables solo en status='active'|'pending_resumption'.

import type { Stoppage, StoppageStatus } from './stoppageEngine.js';

interface StoppageQuery {
  where(field: string, op: '==' | '>=' | '<=', value: unknown): StoppageQuery;
  orderBy(field: string, dir: 'asc' | 'desc'): StoppageQuery;
  limit(n: number): StoppageQuery;
  get(): Promise<{ docs: Array<{ id: string; data(): Record<string, unknown> }> }>;
}

export interface StoppageFirestoreDb {
  collection(path: string): {
    doc(id: string): {
      get(): Promise<{ exists: boolean; data(): Record<string, unknown> | undefined }>;
      set(data: Record<string, unknown>): Promise<void>;
      update(patch: Record<string, unknown>): Promise<void>;
    };
    where(field: string, op: '==' | '>=' | '<=', value: unknown): StoppageQuery;
    orderBy(field: string, dir: 'asc' | 'desc'): StoppageQuery;
    limit(n: number): StoppageQuery;
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
    return snap.exists ? (snap.data() as unknown as Stoppage) : null;
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
    return snap.docs.map((d) => d.data() as unknown as Stoppage);
  }

  private toFirestore(s: Stoppage): Record<string, any> {
    return { ...s };
  }
}

// Persistence #15: visitor access adapter.
// Schema: tenants/{tid}/projects/{pid}/visitor_accesses/{id}
// Indexes: (checkedInAt desc), (kind, checkedInAt desc), (hostUid)

import type { VisitorAccess, VisitorKind } from './visitorAccessService.js';

export interface VisitorFirestoreDb {
  collection(path: string): any;
}

const PATH = (tid: string, pid: string) =>
  `tenants/${tid}/projects/${pid}/visitor_accesses`;

export class VisitorAdapter {
  constructor(
    private readonly db: VisitorFirestoreDb,
    private readonly tenantId: string,
    private readonly projectId: string,
  ) {}

  async save(visitor: VisitorAccess): Promise<void> {
    await this.db.collection(PATH(this.tenantId, this.projectId)).doc(visitor.id).set(visitor);
  }

  async getById(id: string): Promise<VisitorAccess | null> {
    const snap = await this.db.collection(PATH(this.tenantId, this.projectId)).doc(id).get();
    return snap.exists ? (snap.data() as VisitorAccess) : null;
  }

  async recordCheckout(id: string, checkedOutAt: string): Promise<void> {
    await this.db
      .collection(PATH(this.tenantId, this.projectId))
      .doc(id)
      .update({ checkedOutAt });
  }

  async listActive(): Promise<VisitorAccess[]> {
    // Sin where porque Firestore no soporta "campo no existe". Filtramos
    // client-side. Es OK para visitas activas (decenas, no miles).
    const snap = await this.db.collection(PATH(this.tenantId, this.projectId)).get();
    return snap.docs
      .map((d: any) => d.data() as VisitorAccess)
      .filter((v: VisitorAccess) => !v.checkedOutAt);
  }

  async listByKind(kind: VisitorKind, limitN = 100): Promise<VisitorAccess[]> {
    const snap = await this.db
      .collection(PATH(this.tenantId, this.projectId))
      .where('kind', '==', kind)
      .orderBy('checkedInAt', 'desc')
      .limit(limitN)
      .get();
    return snap.docs.map((d: any) => d.data() as VisitorAccess);
  }

  async listForHost(hostUid: string, limitN = 50): Promise<VisitorAccess[]> {
    const snap = await this.db
      .collection(PATH(this.tenantId, this.projectId))
      .where('hostUid', '==', hostUid)
      .orderBy('checkedInAt', 'desc')
      .limit(limitN)
      .get();
    return snap.docs.map((d: any) => d.data() as VisitorAccess);
  }
}

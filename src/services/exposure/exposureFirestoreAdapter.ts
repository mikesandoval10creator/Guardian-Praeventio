// Persistence #5: exposureRegistry adapter.
// Schema: tenants/{tid}/projects/{pid}/exposure_measurements/{id}
// Indexes: (workerUid, agent, takenAt desc), (agent, takenAt desc)

import type { ExposureMeasurement, ExposureAgent } from './exposureRegistry.js';

export interface ExposureFirestoreDb {
  collection(path: string): any;
}

const PATH = (tid: string, pid: string) =>
  `tenants/${tid}/projects/${pid}/exposure_measurements`;

export class ExposureAdapter {
  constructor(
    private readonly db: ExposureFirestoreDb,
    private readonly tenantId: string,
    private readonly projectId: string,
  ) {}

  async save(m: ExposureMeasurement): Promise<void> {
    await this.db.collection(PATH(this.tenantId, this.projectId)).doc(m.id).set(m);
  }

  async getById(id: string): Promise<ExposureMeasurement | null> {
    const snap = await this.db.collection(PATH(this.tenantId, this.projectId)).doc(id).get();
    return snap.exists ? (snap.data() as ExposureMeasurement) : null;
  }

  async listForWorker(workerUid: string, agent?: ExposureAgent): Promise<ExposureMeasurement[]> {
    let q = this.db
      .collection(PATH(this.tenantId, this.projectId))
      .where('workerUid', '==', workerUid);
    if (agent) q = q.where('agent', '==', agent);
    q = q.orderBy('takenAt', 'desc').limit(100);
    const snap = await q.get();
    return snap.docs.map((d: any) => d.data() as ExposureMeasurement);
  }

  async listByAgent(agent: ExposureAgent): Promise<ExposureMeasurement[]> {
    const snap = await this.db
      .collection(PATH(this.tenantId, this.projectId))
      .where('agent', '==', agent)
      .orderBy('takenAt', 'desc')
      .limit(200)
      .get();
    return snap.docs.map((d: any) => d.data() as ExposureMeasurement);
  }
}

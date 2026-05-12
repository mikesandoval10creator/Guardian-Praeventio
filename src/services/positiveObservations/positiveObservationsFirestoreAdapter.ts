// Persistence #18: positive observations adapter.
// Schema: tenants/{tid}/projects/{pid}/positive_observations/{id}
// Indexes: (observedWorkerUid, observedAt desc),
//          (kind, observedAt desc), (location, observedAt desc)

import type {
  PositiveObservation,
  PositiveObservationKind,
} from './positiveObservationsService.js';

export interface PositiveObservationsFirestoreDb {
  collection(path: string): any;
}

const PATH = (tid: string, pid: string) =>
  `tenants/${tid}/projects/${pid}/positive_observations`;

export class PositiveObservationsAdapter {
  constructor(
    private readonly db: PositiveObservationsFirestoreDb,
    private readonly tenantId: string,
    private readonly projectId: string,
  ) {}

  async save(observation: PositiveObservation): Promise<void> {
    await this.db
      .collection(PATH(this.tenantId, this.projectId))
      .doc(observation.id)
      .set(observation);
  }

  async getById(id: string): Promise<PositiveObservation | null> {
    const snap = await this.db.collection(PATH(this.tenantId, this.projectId)).doc(id).get();
    return snap.exists ? (snap.data() as PositiveObservation) : null;
  }

  async listForWorker(observedWorkerUid: string, limitN = 50): Promise<PositiveObservation[]> {
    const snap = await this.db
      .collection(PATH(this.tenantId, this.projectId))
      .where('observedWorkerUid', '==', observedWorkerUid)
      .orderBy('observedAt', 'desc')
      .limit(limitN)
      .get();
    return snap.docs.map((d: any) => d.data() as PositiveObservation);
  }

  async listByKind(kind: PositiveObservationKind, limitN = 100): Promise<PositiveObservation[]> {
    const snap = await this.db
      .collection(PATH(this.tenantId, this.projectId))
      .where('kind', '==', kind)
      .orderBy('observedAt', 'desc')
      .limit(limitN)
      .get();
    return snap.docs.map((d: any) => d.data() as PositiveObservation);
  }

  async countSince(sinceIso: string): Promise<number> {
    const snap = await this.db
      .collection(PATH(this.tenantId, this.projectId))
      .where('observedAt', '>=', sinceIso)
      .get();
    return snap.docs.length;
  }
}

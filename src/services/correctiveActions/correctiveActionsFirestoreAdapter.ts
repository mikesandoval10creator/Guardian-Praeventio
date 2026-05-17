// Persistence #19: corrective actions adapter.
// Schema: tenants/{tid}/projects/{pid}/corrective_actions/{id}
// Indexes: (status, level), (status, isSystemic), (sourceCause)
//
// Mantiene el catálogo de acciones correctivas con todos los datos
// necesarios para detectWeakLanguage + buildBalanceReport +
// detectDuplicateActions + checkRecidivism.

import type {
  CorrectiveAction,
  CorrectiveActionLevel,
} from './weakActionDetector.js';

export interface CorrectiveActionsFirestoreDb {
  collection(path: string): any;
}

const PATH = (tid: string, pid: string) =>
  `tenants/${tid}/projects/${pid}/corrective_actions`;

export class CorrectiveActionsAdapter {
  constructor(
    private readonly db: CorrectiveActionsFirestoreDb,
    private readonly tenantId: string,
    private readonly projectId: string,
  ) {}

  async save(action: CorrectiveAction): Promise<void> {
    await this.db.collection(PATH(this.tenantId, this.projectId)).doc(action.id).set(action);
  }

  async getById(id: string): Promise<CorrectiveAction | null> {
    const snap = await this.db.collection(PATH(this.tenantId, this.projectId)).doc(id).get();
    return snap.exists ? (snap.data() as CorrectiveAction) : null;
  }

  async updateStatus(
    id: string,
    status: CorrectiveAction['status'],
  ): Promise<void> {
    await this.db
      .collection(PATH(this.tenantId, this.projectId))
      .doc(id)
      .update({ status });
  }

  /**
   * Codex P2 round 3 (PR #309): widened to accept the extended F.4
   * statuses (`in_progress`, `reopened`) in addition to the legacy
   * trio. The legacy weakActionDetector type is narrower but the
   * Firestore query is just a `==` on the column — records with the
   * extended states should be returned without coercion.
   */
  async listByStatus(
    status:
      | CorrectiveAction['status']
      | 'in_progress'
      | 'reopened',
    limitN = 200,
  ): Promise<CorrectiveAction[]> {
    const snap = await this.db
      .collection(PATH(this.tenantId, this.projectId))
      .where('status', '==', status)
      .limit(limitN)
      .get();
    return snap.docs.map((d: any) => d.data() as CorrectiveAction);
  }

  async listByLevel(level: CorrectiveActionLevel, limitN = 100): Promise<CorrectiveAction[]> {
    const snap = await this.db
      .collection(PATH(this.tenantId, this.projectId))
      .where('level', '==', level)
      .limit(limitN)
      .get();
    return snap.docs.map((d: any) => d.data() as CorrectiveAction);
  }

  async listSystemic(): Promise<CorrectiveAction[]> {
    const snap = await this.db
      .collection(PATH(this.tenantId, this.projectId))
      .where('isSystemic', '==', true)
      .get();
    return snap.docs.map((d: any) => d.data() as CorrectiveAction);
  }
}

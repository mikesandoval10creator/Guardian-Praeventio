// Persistence #16: LOTO digital adapter.
// Schema:
//   tenants/{tid}/projects/{pid}/loto_applications/{id}
//   tenants/{tid}/projects/{pid}/loto_applications/{id}/audit/{at}
//
// Indexes: (equipmentId, appliedAt desc), (leaderUid, appliedAt desc)
//
// Audit subcollection contiene log inmutable de cada evento (aplicación,
// verificación cero energía, liberación). Doc principal mantiene snapshot
// del estado actual; el log es para legal.

import type { LotoApplication } from './lotoDigitalLight.js';

export interface LotoFirestoreDb {
  collection(path: string): any;
}

const APP_PATH = (tid: string, pid: string) =>
  `tenants/${tid}/projects/${pid}/loto_applications`;
const AUDIT_PATH = (tid: string, pid: string, appId: string) =>
  `tenants/${tid}/projects/${pid}/loto_applications/${appId}/audit`;

export type LotoAuditEventKind =
  | 'created'
  | 'lock_point_applied'
  | 'zero_energy_verified'
  | 'partial_release'
  | 'full_release';

export interface LotoAuditEvent {
  /** ISO-8601 — sirve como doc id. */
  at: string;
  kind: LotoAuditEventKind;
  actorUid: string;
  /** Notas / detalle. */
  detail: string;
}

export class LotoAdapter {
  constructor(
    private readonly db: LotoFirestoreDb,
    private readonly tenantId: string,
    private readonly projectId: string,
  ) {}

  async save(app: LotoApplication): Promise<void> {
    await this.db.collection(APP_PATH(this.tenantId, this.projectId)).doc(app.id).set(app);
  }

  async getById(id: string): Promise<LotoApplication | null> {
    const snap = await this.db.collection(APP_PATH(this.tenantId, this.projectId)).doc(id).get();
    return snap.exists ? (snap.data() as LotoApplication) : null;
  }

  async appendAudit(appId: string, event: LotoAuditEvent): Promise<void> {
    await this.db
      .collection(AUDIT_PATH(this.tenantId, this.projectId, appId))
      .doc(event.at)
      .set(event);
  }

  async listAudit(appId: string): Promise<LotoAuditEvent[]> {
    const snap = await this.db
      .collection(AUDIT_PATH(this.tenantId, this.projectId, appId))
      .orderBy('at', 'asc')
      .get();
    return snap.docs.map((d: any) => d.data() as LotoAuditEvent);
  }

  async listForEquipment(equipmentId: string, limitN = 50): Promise<LotoApplication[]> {
    const snap = await this.db
      .collection(APP_PATH(this.tenantId, this.projectId))
      .where('equipmentId', '==', equipmentId)
      .orderBy('appliedAt', 'desc')
      .limit(limitN)
      .get();
    return snap.docs.map((d: any) => d.data() as LotoApplication);
  }

  async listActive(): Promise<LotoApplication[]> {
    const snap = await this.db.collection(APP_PATH(this.tenantId, this.projectId)).get();
    return snap.docs
      .map((d: any) => d.data() as LotoApplication)
      .filter((a: LotoApplication) => !a.fullyReleasedAt);
  }
}

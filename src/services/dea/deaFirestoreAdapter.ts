// Persistence #N (Sprint C — 2026-05-15): DEA Firestore adapter.
//
// Schema:
//   tenants/{tid}/projects/{pid}/deas/{id}                          ← DEA master
//   tenants/{tid}/projects/{pid}/deas/{id}/inspections/{insId}      ← historial inspecciones
//
// Index recomendado:
//   (status), (assignedToUid), (batteryExpiry), (padsExpiry)
//
// Si en el futuro se necesita "lista de DEAs por status del tenant
// cruzado todos los projects" — agregar collectionGroup query y un
// index compuesto. Por ahora todas las queries van por project para
// matchear la unidad operativa del prevencionista.

import type { Dea, DeaInspection } from './deaService.js';

export interface DeaFirestoreDb {
  collection(path: string): any;
}

const DEA_PATH = (tid: string, pid: string) =>
  `tenants/${tid}/projects/${pid}/deas`;
const INSPECTION_PATH = (tid: string, pid: string, deaId: string) =>
  `tenants/${tid}/projects/${pid}/deas/${deaId}/inspections`;

export class DeaAdapter {
  constructor(
    private readonly db: DeaFirestoreDb,
    private readonly tenantId: string,
    private readonly projectId: string,
  ) {}

  async save(dea: Dea): Promise<void> {
    await this.db
      .collection(DEA_PATH(this.tenantId, this.projectId))
      .doc(dea.id)
      .set(dea);
  }

  async getById(id: string): Promise<Dea | null> {
    const snap = await this.db
      .collection(DEA_PATH(this.tenantId, this.projectId))
      .doc(id)
      .get();
    return snap.exists ? (snap.data() as Dea) : null;
  }

  /** Lista todos los DEAs del proyecto. */
  async listAll(limitN = 200): Promise<Dea[]> {
    const snap = await this.db
      .collection(DEA_PATH(this.tenantId, this.projectId))
      .limit(limitN)
      .get();
    return snap.docs.map((d: any) => d.data() as Dea);
  }

  /** Lista DEAs por responsable asignado. */
  async listByAssignedTo(uid: string, limitN = 50): Promise<Dea[]> {
    const snap = await this.db
      .collection(DEA_PATH(this.tenantId, this.projectId))
      .where('assignedToUid', '==', uid)
      .limit(limitN)
      .get();
    return snap.docs.map((d: any) => d.data() as Dea);
  }

  /**
   * Registra una inspección. NO actualiza el DEA master — el caller
   * debe decidir cómo se refleja en `lastCheck` y `status` (ver
   * `markInspectionAndUpdateLastCheck` para el flujo canónico).
   */
  async appendInspection(inspection: DeaInspection): Promise<void> {
    await this.db
      .collection(
        INSPECTION_PATH(this.tenantId, this.projectId, inspection.deaId),
      )
      .doc(inspection.id)
      .set(inspection);
  }

  /**
   * Flujo canónico: guarda la inspección Y actualiza `lastCheck` del
   * DEA master en la misma escritura lógica. Si la inspección falló
   * (algún item del checklist false), el caller debería pasar
   * `markStatusCritical: true` para forzar status crítico hasta que
   * se haga una nueva inspección OK.
   */
  async markInspectionAndUpdateLastCheck(
    inspection: DeaInspection,
    opts: { markStatusCritical?: boolean } = {},
  ): Promise<void> {
    await this.appendInspection(inspection);
    const update: Partial<Dea> & Record<string, unknown> = {
      lastCheck: inspection.performedAt,
    };
    if (opts.markStatusCritical) {
      // Status calculado luego por `computeDeaStatus` desde fechas reales,
      // pero dejamos un flag para que el reaper lo respete.
      update.criticalOverride = true;
    } else {
      update.criticalOverride = false;
    }
    await this.db
      .collection(DEA_PATH(this.tenantId, this.projectId))
      .doc(inspection.deaId)
      .update(update);
  }

  async listInspectionsForDea(
    deaId: string,
    limitN = 50,
  ): Promise<DeaInspection[]> {
    const snap = await this.db
      .collection(INSPECTION_PATH(this.tenantId, this.projectId, deaId))
      .orderBy('performedAt', 'desc')
      .limit(limitN)
      .get();
    return snap.docs.map((d: any) => d.data() as DeaInspection);
  }
}

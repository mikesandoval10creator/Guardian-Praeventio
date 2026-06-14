// Praeventio Guard — Sprint 39 Persistence Layer #4: evacuationHeadcount adapter.
//
// Schema:
//   tenants/{tid}/projects/{pid}/evacuations/{drillId}
//   tenants/{tid}/projects/{pid}/evacuations/{drillId}/scans/{auto}
//
// Scans separados a subcollection para no inflar el doc parent + permitir
// rules independientes (cualquier worker puede agregar scan a su uid;
// solo supervisor inicia/finaliza drill).

import type { EvacuationDrill, EvacuationScan } from './evacuationHeadcount.js';
import { recordScan } from './evacuationHeadcount.js';

export interface EvacuationFirestoreDb {
  collection(path: string): any;
}

const DRILLS_PATH = (tid: string, pid: string) =>
  `tenants/${tid}/projects/${pid}/evacuations`;
const SCANS_SUBCOLL = 'scans';

export class EvacuationAdapter {
  constructor(
    private readonly db: EvacuationFirestoreDb,
    private readonly tenantId: string,
    private readonly projectId: string,
  ) {}

  async startDrill(drill: EvacuationDrill): Promise<void> {
    await this.db
      .collection(DRILLS_PATH(this.tenantId, this.projectId))
      .doc(drill.id)
      .set(this.serializeDrill(drill));
  }

  async getDrill(drillId: string): Promise<EvacuationDrill | null> {
    const docSnap = await this.db
      .collection(DRILLS_PATH(this.tenantId, this.projectId))
      .doc(drillId)
      .get();
    if (!docSnap.exists) return null;
    const drill = this.deserializeDrill(docSnap.data());

    // Cargar scans desde subcollection
    const scansSnap = await this.db
      .collection(
        `${DRILLS_PATH(this.tenantId, this.projectId)}/${drillId}/${SCANS_SUBCOLL}`,
      )
      .get();
    const scans: EvacuationScan[] = scansSnap.docs.map((d: any) => d.data() as EvacuationScan);
    return { ...drill, scans };
  }

  /**
   * Idempotente: si workerUid ya escaneó, no duplica. Usa el workerUid
   * como doc id del scan para garantizar unicidad.
   */
  async addScan(drillId: string, scan: Omit<EvacuationScan, 'scannedAt'> & { scannedAt?: string }): Promise<void> {
    const id = scan.workerUid;
    const scansCol = this.db.collection(
      `${DRILLS_PATH(this.tenantId, this.projectId)}/${drillId}/${SCANS_SUBCOLL}`,
    );
    const existing = await scansCol.doc(id).get();
    if (existing.exists) return; // idempotente
    await scansCol.doc(id).set({
      workerUid: scan.workerUid,
      scannedAt: scan.scannedAt ?? new Date().toISOString(),
      meetingPointId: scan.meetingPointId,
      scannedByUid: scan.scannedByUid,
    });
  }

  async endDrill(drillId: string, endedAt: string = new Date().toISOString()): Promise<void> {
    await this.db
      .collection(DRILLS_PATH(this.tenantId, this.projectId))
      .doc(drillId)
      .update({ endedAt });
  }

  /**
   * Drills ACTIVOS (no finalizados). Usado para el guard de "un solo drill
   * activo por proyecto" — filtra por `endedAt == null` (serializeDrill escribe
   * `endedAt: d.endedAt ?? null`, así que la igualdad es confiable) SIN ventana
   * de recencia, para no perder un drill activo antiguo bajo muchos finalizados.
   */
  async listActive(): Promise<EvacuationDrill[]> {
    const snap = await this.db
      .collection(DRILLS_PATH(this.tenantId, this.projectId))
      .where('endedAt', '==', null)
      .get();
    return snap.docs.map((d: any) => this.deserializeDrill(d.data()));
  }

  /**
   * Lista drills recientes (sin scans para velocidad).
   */
  async listRecent(limit: number = 20): Promise<EvacuationDrill[]> {
    const snap = await this.db
      .collection(DRILLS_PATH(this.tenantId, this.projectId))
      .orderBy('startedAt', 'desc')
      .limit(limit)
      .get();
    return snap.docs.map((d: any) => this.deserializeDrill(d.data()));
  }

  private serializeDrill(d: EvacuationDrill): Record<string, any> {
    // Sin scans aquí — viven en subcollection
    return {
      id: d.id,
      projectId: d.projectId,
      kind: d.kind,
      startedAt: d.startedAt,
      startedByUid: d.startedByUid,
      meetingPointId: d.meetingPointId,
      expectedWorkers: d.expectedWorkers,
      endedAt: d.endedAt ?? null,
    };
  }

  private deserializeDrill(data: any): EvacuationDrill {
    return {
      id: data.id,
      projectId: data.projectId,
      kind: data.kind,
      startedAt: data.startedAt,
      startedByUid: data.startedByUid,
      meetingPointId: data.meetingPointId,
      expectedWorkers: data.expectedWorkers ?? [],
      scans: [],
      endedAt: data.endedAt ?? undefined,
    };
  }
}

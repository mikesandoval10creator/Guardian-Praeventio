// Persistence #10: equipmentQrService adapter.
// Schema:
//   tenants/{tid}/projects/{pid}/equipment/{id}                  ← equipment master
//   tenants/{tid}/projects/{pid}/equipment/{id}/pre_uses/{vid}   ← pre-use validations
//
// Indexes: (status), (criticality, status), (type)
// Pre-uses subcollection indexes: (startedAt desc), (workerUid, startedAt desc)
//
// Persisting pre-uses as subcollection (instead of inline array) avoids
// document bloat for high-use equipment (gruahorquilla validated daily
// by 3+ workers can accumulate thousands of validations over a project).

import type {
  Equipment,
  EquipmentStatus,
  PreUseValidation,
} from './equipmentQrService.js';

export interface EquipmentFirestoreDb {
  collection(path: string): any;
}

const EQUIP_PATH = (tid: string, pid: string) =>
  `tenants/${tid}/projects/${pid}/equipment`;
const PRE_USE_PATH = (tid: string, pid: string, equipmentId: string) =>
  `tenants/${tid}/projects/${pid}/equipment/${equipmentId}/pre_uses`;

export class EquipmentAdapter {
  constructor(
    private readonly db: EquipmentFirestoreDb,
    private readonly tenantId: string,
    private readonly projectId: string,
  ) {}

  async save(equipment: Equipment): Promise<void> {
    await this.db
      .collection(EQUIP_PATH(this.tenantId, this.projectId))
      .doc(equipment.id)
      .set(equipment);
  }

  async getById(id: string): Promise<Equipment | null> {
    const snap = await this.db
      .collection(EQUIP_PATH(this.tenantId, this.projectId))
      .doc(id)
      .get();
    return snap.exists ? (snap.data() as Equipment) : null;
  }

  async updateStatus(id: string, status: EquipmentStatus): Promise<void> {
    await this.db
      .collection(EQUIP_PATH(this.tenantId, this.projectId))
      .doc(id)
      .update({ status });
  }

  async listByStatus(status: EquipmentStatus, limitN = 200): Promise<Equipment[]> {
    const snap = await this.db
      .collection(EQUIP_PATH(this.tenantId, this.projectId))
      .where('status', '==', status)
      .limit(limitN)
      .get();
    return snap.docs.map((d: any) => d.data() as Equipment);
  }

  async appendPreUse(validation: PreUseValidation): Promise<void> {
    await this.db
      .collection(PRE_USE_PATH(this.tenantId, this.projectId, validation.equipmentId))
      .doc(validation.id)
      .set(validation);
  }

  async listPreUsesForEquipment(
    equipmentId: string,
    limitN = 50,
  ): Promise<PreUseValidation[]> {
    const snap = await this.db
      .collection(PRE_USE_PATH(this.tenantId, this.projectId, equipmentId))
      .orderBy('startedAt', 'desc')
      .limit(limitN)
      .get();
    return snap.docs.map((d: any) => d.data() as PreUseValidation);
  }
}

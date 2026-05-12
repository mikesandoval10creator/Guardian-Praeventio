// Persistence #21: waste records + manifests adapter.
// Schema:
//   tenants/{tid}/projects/{pid}/waste_records/{id}
//   tenants/{tid}/projects/{pid}/waste_manifests/{id}
//   tenants/{tid}/projects/{pid}/environmental_permits/{id}

import type {
  WasteRecord,
  WasteManifest,
  EnvironmentalPermit,
} from './environmentalCompliance.js';

export interface WasteFirestoreDb {
  collection(path: string): any;
}

const WASTE_PATH = (tid: string, pid: string) =>
  `tenants/${tid}/projects/${pid}/waste_records`;
const MANIFEST_PATH = (tid: string, pid: string) =>
  `tenants/${tid}/projects/${pid}/waste_manifests`;
const PERMIT_PATH = (tid: string, pid: string) =>
  `tenants/${tid}/projects/${pid}/environmental_permits`;

export class WasteAdapter {
  constructor(
    private readonly db: WasteFirestoreDb,
    private readonly tenantId: string,
    private readonly projectId: string,
  ) {}

  // ── Waste records ──
  async saveWaste(record: WasteRecord): Promise<void> {
    await this.db.collection(WASTE_PATH(this.tenantId, this.projectId)).doc(record.id).set(record);
  }

  async getWaste(id: string): Promise<WasteRecord | null> {
    const snap = await this.db.collection(WASTE_PATH(this.tenantId, this.projectId)).doc(id).get();
    return snap.exists ? (snap.data() as WasteRecord) : null;
  }

  async listInStock(): Promise<WasteRecord[]> {
    const snap = await this.db.collection(WASTE_PATH(this.tenantId, this.projectId)).get();
    return snap.docs
      .map((d: any) => d.data() as WasteRecord)
      .filter((w: WasteRecord) => !w.manifestId);
  }

  async listByKind(kind: WasteRecord['kind'], limitN = 100): Promise<WasteRecord[]> {
    const snap = await this.db
      .collection(WASTE_PATH(this.tenantId, this.projectId))
      .where('kind', '==', kind)
      .orderBy('generatedAt', 'desc')
      .limit(limitN)
      .get();
    return snap.docs.map((d: any) => d.data() as WasteRecord);
  }

  async linkToManifest(wasteIds: string[], manifestId: string): Promise<void> {
    for (const wid of wasteIds) {
      await this.db
        .collection(WASTE_PATH(this.tenantId, this.projectId))
        .doc(wid)
        .update({ manifestId });
    }
  }

  // ── Manifests ──
  async saveManifest(manifest: WasteManifest): Promise<void> {
    await this.db
      .collection(MANIFEST_PATH(this.tenantId, this.projectId))
      .doc(manifest.id)
      .set(manifest);
  }

  async getManifest(id: string): Promise<WasteManifest | null> {
    const snap = await this.db
      .collection(MANIFEST_PATH(this.tenantId, this.projectId))
      .doc(id)
      .get();
    return snap.exists ? (snap.data() as WasteManifest) : null;
  }

  async recordManifestReception(
    manifestId: string,
    receivedAt: string,
    hasDiscrepancy: boolean,
  ): Promise<void> {
    await this.db
      .collection(MANIFEST_PATH(this.tenantId, this.projectId))
      .doc(manifestId)
      .update({ receivedAt, hasDiscrepancy });
  }

  async listManifestsPendingReception(): Promise<WasteManifest[]> {
    const snap = await this.db.collection(MANIFEST_PATH(this.tenantId, this.projectId)).get();
    return snap.docs
      .map((d: any) => d.data() as WasteManifest)
      .filter((m: WasteManifest) => !m.receivedAt);
  }

  // ── Permits ──
  async savePermit(permit: EnvironmentalPermit): Promise<void> {
    await this.db
      .collection(PERMIT_PATH(this.tenantId, this.projectId))
      .doc(permit.id)
      .set(permit);
  }

  async listPermits(): Promise<EnvironmentalPermit[]> {
    const snap = await this.db
      .collection(PERMIT_PATH(this.tenantId, this.projectId))
      .orderBy('expiresAt', 'asc')
      .get();
    return snap.docs.map((d: any) => d.data() as EnvironmentalPermit);
  }
}

// Persistence #23: Gaussian Splat captures adapter.
// Schema: tenants/{tid}/projects/{pid}/splat_captures/{id}
// Indexes: (capturedAt desc), (isCanonical, capturedAt desc)

import type { SplatCapture, SplatFormat } from './gaussianSplatRegistry.js';

export interface SplatFirestoreDb {
  collection(path: string): any;
}

const PATH = (tid: string, pid: string) =>
  `tenants/${tid}/projects/${pid}/splat_captures`;

export class SplatCaptureAdapter {
  constructor(
    private readonly db: SplatFirestoreDb,
    private readonly tenantId: string,
    private readonly projectId: string,
  ) {}

  async save(capture: SplatCapture): Promise<void> {
    await this.db.collection(PATH(this.tenantId, this.projectId)).doc(capture.id).set(capture);
  }

  async getById(id: string): Promise<SplatCapture | null> {
    const snap = await this.db.collection(PATH(this.tenantId, this.projectId)).doc(id).get();
    return snap.exists ? (snap.data() as SplatCapture) : null;
  }

  async listRecent(limitN = 20): Promise<SplatCapture[]> {
    const snap = await this.db
      .collection(PATH(this.tenantId, this.projectId))
      .orderBy('capturedAt', 'desc')
      .limit(limitN)
      .get();
    return snap.docs.map((d: any) => d.data() as SplatCapture);
  }

  async getCanonical(): Promise<SplatCapture | null> {
    const snap = await this.db
      .collection(PATH(this.tenantId, this.projectId))
      .where('isCanonical', '==', true)
      .limit(1)
      .get();
    if (snap.empty) return null;
    return snap.docs[0].data() as SplatCapture;
  }

  /**
   * Marca una captura como canónica. Atómicamente desmarca las anteriores
   * (solo una puede ser canónica al mismo tiempo).
   */
  async setCanonical(captureId: string): Promise<void> {
    // 1. Get all canonical
    const previousSnap = await this.db
      .collection(PATH(this.tenantId, this.projectId))
      .where('isCanonical', '==', true)
      .get();
    for (const doc of previousSnap.docs) {
      if (doc.id !== captureId) {
        await this.db
          .collection(PATH(this.tenantId, this.projectId))
          .doc(doc.id)
          .update({ isCanonical: false });
      }
    }
    // 2. Mark target
    await this.db
      .collection(PATH(this.tenantId, this.projectId))
      .doc(captureId)
      .update({ isCanonical: true });
  }

  async listByFormat(format: SplatFormat, limitN = 50): Promise<SplatCapture[]> {
    const snap = await this.db
      .collection(PATH(this.tenantId, this.projectId))
      .where('format', '==', format)
      .orderBy('capturedAt', 'desc')
      .limit(limitN)
      .get();
    return snap.docs.map((d: any) => d.data() as SplatCapture);
  }
}

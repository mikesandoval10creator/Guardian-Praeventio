// Persistence #12: exceptionEngine adapter.
// Schema: tenants/{tid}/projects/{pid}/exceptions/{id}
// Indexes:
//   (status, validUntil)               ← cron auto-expire
//   (subjectRef.kind, subjectRef.id)   ← lookup excepciones de un trabajador/EPP
//   (domain, status)                   ← bandeja prevencionista
//   (approvedByUid, approvedAt desc)   ← auditoría aprobador
//
// Cron job (Cloud Function diaria) llama `expireOverdue(now)` para mover
// excepciones con validUntil < now y status='active' → status='expired'.

import type {
  ExceptionRecord,
  ExceptionDomain,
  ExceptionStatus,
} from './exceptionEngine.js';

export interface ExceptionFirestoreDb {
  collection(path: string): any;
}

const PATH = (tid: string, pid: string) =>
  `tenants/${tid}/projects/${pid}/exceptions`;

export class ExceptionAdapter {
  constructor(
    private readonly db: ExceptionFirestoreDb,
    private readonly tenantId: string,
    private readonly projectId: string,
  ) {}

  async save(record: ExceptionRecord): Promise<void> {
    await this.db.collection(PATH(this.tenantId, this.projectId)).doc(record.id).set(record);
  }

  async getById(id: string): Promise<ExceptionRecord | null> {
    const snap = await this.db.collection(PATH(this.tenantId, this.projectId)).doc(id).get();
    return snap.exists ? (snap.data() as ExceptionRecord) : null;
  }

  async updateStatus(
    id: string,
    patch: Partial<
      Pick<
        ExceptionRecord,
        'status' | 'revokedAt' | 'revokedByUid' | 'revokedReason' | 'fulfilledAt'
      >
    >,
  ): Promise<void> {
    await this.db.collection(PATH(this.tenantId, this.projectId)).doc(id).update(patch);
  }

  async listActive(limitN = 200): Promise<ExceptionRecord[]> {
    const snap = await this.db
      .collection(PATH(this.tenantId, this.projectId))
      .where('status', '==', 'active')
      .limit(limitN)
      .get();
    return snap.docs.map((d: any) => d.data() as ExceptionRecord);
  }

  async listByDomain(domain: ExceptionDomain, status?: ExceptionStatus): Promise<ExceptionRecord[]> {
    let q = this.db
      .collection(PATH(this.tenantId, this.projectId))
      .where('domain', '==', domain);
    if (status) q = q.where('status', '==', status);
    const snap = await q.get();
    return snap.docs.map((d: any) => d.data() as ExceptionRecord);
  }

  async listForSubject(
    kind: ExceptionRecord['subjectRef']['kind'],
    id: string,
  ): Promise<ExceptionRecord[]> {
    // El esquema almacena subjectRef como objeto anidado. Firestore
    // permite igualdad sobre nested keys con dot notation. La lookup
    // determinística usa ambos campos.
    const snap = await this.db
      .collection(PATH(this.tenantId, this.projectId))
      .where('subjectRef.kind', '==', kind)
      .where('subjectRef.id', '==', id)
      .get();
    return snap.docs.map((d: any) => d.data() as ExceptionRecord);
  }

  /**
   * Cron-friendly: mueve excepciones vencidas (active + validUntil < nowIso)
   * a status='expired'. Devuelve la cantidad expirada.
   */
  async expireOverdue(nowIso: string): Promise<number> {
    const snap = await this.db
      .collection(PATH(this.tenantId, this.projectId))
      .where('status', '==', 'active')
      .get();
    const overdue = snap.docs.filter((d: any) => {
      const data = d.data() as ExceptionRecord;
      return data.validUntil < nowIso;
    });
    for (const d of overdue) {
      await this.db
        .collection(PATH(this.tenantId, this.projectId))
        .doc(d.id)
        .update({ status: 'expired' });
    }
    return overdue.length;
  }
}

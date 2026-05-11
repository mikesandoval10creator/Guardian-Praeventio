// Praeventio Guard — Sprint 39 Persistence Layer #2: workPermitEngine adapter.
//
// Schema:
//   tenants/{tid}/projects/{pid}/work_permits/{id}
//
// Indexes mínimos:
//   (status, validUntil) — query "permisos por vencer"
//   (workerUid, status) — query "mis permisos activos"
//   (kind, validUntil DESC)
//
// Rules:
//   - read: isProjectMember + tenant claim
//   - create: roles ['supervisor', 'prevencionista', 'gerente', 'admin']
//     SOLO si data.preconditions valida (validado por server al crear)
//   - update: status transitions controladas (active → cancelled |
//     fulfilled | expired). NO permite editar campos críticos
//     (workerUid, approverUid, validUntil) post-creación.

import type { WorkPermit, WorkPermitKind, WorkPermitStatus } from './workPermitEngine.js';

// ────────────────────────────────────────────────────────────────────────
// DI shape
// ────────────────────────────────────────────────────────────────────────

export interface WorkPermitFirestoreDb {
  collection(path: string): WpCollectionRef;
}

interface WpCollectionRef {
  doc(id: string): WpDocRef;
  where(field: string, op: '==' | '>=' | '<=', value: any): WpQuery;
  orderBy(field: string, dir: 'asc' | 'desc'): WpQuery;
  limit(n: number): WpQuery;
}

interface WpDocRef {
  get(): Promise<{ exists: boolean; id: string; data(): any | undefined }>;
  set(data: any): Promise<void>;
  update(patch: any): Promise<void>;
}

interface WpQuery {
  where(field: string, op: '==' | '>=' | '<=', value: any): WpQuery;
  orderBy(field: string, dir: 'asc' | 'desc'): WpQuery;
  limit(n: number): WpQuery;
  get(): Promise<{ empty: boolean; docs: Array<{ id: string; data(): any }> }>;
}

const PATH = (tid: string, pid: string) =>
  `tenants/${tid}/projects/${pid}/work_permits`;

// ────────────────────────────────────────────────────────────────────────
// Adapter
// ────────────────────────────────────────────────────────────────────────

export interface WorkPermitAdapterDeps {
  db: WorkPermitFirestoreDb;
  tenantId: string;
  projectId: string;
}

export class WorkPermitAdapter {
  constructor(private readonly deps: WorkPermitAdapterDeps) {}

  async save(permit: WorkPermit): Promise<void> {
    const ref = this.deps.db.collection(PATH(this.deps.tenantId, this.deps.projectId)).doc(permit.id);
    await ref.set(serialize(permit));
  }

  async getById(id: string): Promise<WorkPermit | null> {
    const ref = this.deps.db.collection(PATH(this.deps.tenantId, this.deps.projectId)).doc(id);
    const snap = await ref.get();
    if (!snap.exists) return null;
    return deserialize(snap.data());
  }

  /**
   * Actualiza solo campos seguros (status, cancelledAt, etc.). No permite
   * mutar workerUid, approverUid, validUntil — esos son inmutables post-issue.
   */
  async updateStatus(
    id: string,
    update: Partial<
      Pick<WorkPermit, 'status' | 'cancelledAt' | 'cancelledReason' | 'fulfilledAt'>
    >,
  ): Promise<void> {
    const ref = this.deps.db.collection(PATH(this.deps.tenantId, this.deps.projectId)).doc(id);
    await ref.update(update);
  }

  /**
   * Lista permisos activos (status='active' y validUntil > now).
   */
  async listActive(now: Date = new Date()): Promise<WorkPermit[]> {
    const q = this.deps.db
      .collection(PATH(this.deps.tenantId, this.deps.projectId))
      .where('status', '==', 'active')
      .where('validUntil', '>=', now.toISOString())
      .orderBy('validUntil', 'asc')
      .limit(200);
    const snap = await q.get();
    return snap.docs.map((d) => deserialize(d.data()));
  }

  /**
   * Permisos del trabajador (cualquier status). Útil para el dashboard
   * del worker.
   */
  async listForWorker(
    workerUid: string,
    status?: WorkPermitStatus,
  ): Promise<WorkPermit[]> {
    let q: WpQuery = this.deps.db
      .collection(PATH(this.deps.tenantId, this.deps.projectId))
      .where('workerUid', '==', workerUid);
    if (status) q = q.where('status', '==', status);
    q = q.orderBy('validFrom', 'desc').limit(50);
    const snap = await q.get();
    return snap.docs.map((d) => deserialize(d.data()));
  }

  /**
   * Permisos por kind, útil para reportes por tipo de riesgo.
   */
  async listByKind(kind: WorkPermitKind): Promise<WorkPermit[]> {
    const q = this.deps.db
      .collection(PATH(this.deps.tenantId, this.deps.projectId))
      .where('kind', '==', kind)
      .orderBy('validFrom', 'desc')
      .limit(100);
    const snap = await q.get();
    return snap.docs.map((d) => deserialize(d.data()));
  }
}

function serialize(p: WorkPermit): Record<string, any> {
  return {
    id: p.id,
    kind: p.kind,
    workerUid: p.workerUid,
    approverUid: p.approverUid,
    approverRole: p.approverRole,
    zoneId: p.zoneId ?? null,
    taskDescription: p.taskDescription,
    status: p.status,
    preconditions: p.preconditions,
    createdAt: p.createdAt,
    approvedAt: p.approvedAt ?? null,
    validFrom: p.validFrom,
    validUntil: p.validUntil,
    cancelledAt: p.cancelledAt ?? null,
    cancelledReason: p.cancelledReason ?? null,
    fulfilledAt: p.fulfilledAt ?? null,
  };
}

function deserialize(data: any): WorkPermit {
  return {
    id: data.id,
    kind: data.kind,
    workerUid: data.workerUid,
    approverUid: data.approverUid,
    approverRole: data.approverRole,
    zoneId: data.zoneId ?? undefined,
    taskDescription: data.taskDescription,
    status: data.status,
    preconditions: data.preconditions,
    createdAt: data.createdAt,
    approvedAt: data.approvedAt ?? undefined,
    validFrom: data.validFrom,
    validUntil: data.validUntil,
    cancelledAt: data.cancelledAt ?? undefined,
    cancelledReason: data.cancelledReason ?? undefined,
    fulfilledAt: data.fulfilledAt ?? undefined,
  };
}

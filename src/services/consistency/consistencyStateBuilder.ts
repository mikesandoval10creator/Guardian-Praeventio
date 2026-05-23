// SPDX-License-Identifier: MIT
// Praeventio Guard — Sprint K wire UI (2026-05-23) consistency state builder.
//
// `consistencyAuditor.ts:runConsistencyAudit` recibe un `ConsistencyState`
// agregado de múltiples colecciones. Este módulo arma ese state leyendo
// de Firestore project-scoped (`projects/{projectId}/<collection>`).
//
// Cuando alguna colección no exista (proyecto nuevo) el builder devuelve
// arrays vacíos para esa parte — el auditor las maneja como "sin data,
// sin inconsistencias" en vez de tirar.

import { db, collection, getDocs, query, limit } from '../firebase';
import type { ConsistencyState } from './consistencyAuditor';

interface WorkerDoc {
  uid?: string;
  role?: string;
  activeTrainings?: string[];
  activeEppLabels?: string[];
  isActive?: boolean;
}

interface TaskAssignmentDoc {
  taskId?: string;
  workerUid?: string;
  riskType?: string;
  requiredTrainings?: string[];
  requiredEpp?: string[];
}

interface DocumentDoc {
  id?: string;
  status?: 'draft' | 'approved' | 'signed' | 'expired';
  signedBy?: string | null;
  approvedAt?: string | null;
}

interface CorrectiveActionDoc {
  id?: string;
  status?: 'open' | 'closed' | 'verified';
  closedAt?: string | null;
  evidenceRequired?: boolean;
  evidenceUrls?: string[];
}

interface WorkPermitDoc {
  id?: string;
  approverUid?: string;
  expiresAt?: string;
  status?: 'active' | 'expired';
}

interface TrainingDoc {
  id?: string;
  workerUid?: string;
  course?: string;
  completedAt?: string | null;
  attendanceRegistered?: boolean;
}

/**
 * Lee una colección con tolerancia a errores (ej. permisos por rules) —
 * devuelve [] en vez de tirar para que el builder no aborte al fallar
 * una sub-colección.
 */
async function readSafe<T>(path: string, limitCount: number = 500): Promise<T[]> {
  try {
    const col = collection(db, path);
    const q = query(col, limit(Math.max(1, Math.min(limitCount, 2000))));
    const snap = await getDocs(q);
    const out: T[] = [];
    snap.forEach((d) => {
      try {
        out.push({ ...(d.data() as T), id: d.id } as T);
      } catch {
        /* skip */
      }
    });
    return out;
  } catch {
    return [];
  }
}

export interface BuildConsistencyStateOptions {
  /** Roles válidos del tenant (default: lista común CL). */
  validRoles?: string[];
  /** EPP esperado por cargo (subset, default vacío). */
  eppByRole?: Record<string, string[]>;
  /** UIDs de aprobadores activos (default: deriva de workers donde role ∈ approver). */
  activeApproverUids?: string[];
}

const DEFAULT_VALID_ROLES = [
  'trabajador',
  'supervisor',
  'prevencionista',
  'gerente',
  'admin',
  'visitante',
  'contratista',
];

/**
 * Construye un `ConsistencyState` real leyendo Firestore project-scoped.
 *
 * Tolera ausencia de colecciones (proyecto recién creado, permisos
 * limitados): los campos faltantes se rellenan con arrays vacíos. El
 * auditor entonces no reporta inconsistencias falsas por data ausente.
 */
export async function buildConsistencyStateFromFirestore(
  projectId: string,
  options: BuildConsistencyStateOptions = {},
): Promise<ConsistencyState> {
  if (!projectId) {
    return {
      workers: [],
      taskAssignments: [],
      documents: [],
      correctiveActions: [],
      workPermits: [],
      trainings: [],
      validRoles: options.validRoles ?? DEFAULT_VALID_ROLES,
      eppByRole: options.eppByRole ?? {},
      activeApproverUids: options.activeApproverUids ?? [],
    };
  }

  // Lectura paralela de TODAS las colecciones relevantes — minimiza
  // round-trip total. Cada read es safe (devuelve [] si falla).
  const [
    workerDocs,
    taskAssignmentDocs,
    documentDocs,
    correctiveActionDocs,
    workPermitDocs,
    trainingDocs,
  ] = await Promise.all([
    readSafe<WorkerDoc>(`projects/${projectId}/workers`),
    readSafe<TaskAssignmentDoc>(`projects/${projectId}/task_assignments`),
    readSafe<DocumentDoc>(`projects/${projectId}/documents`),
    readSafe<CorrectiveActionDoc>(`projects/${projectId}/corrective_actions`),
    readSafe<WorkPermitDoc>(`projects/${projectId}/work_permits`),
    readSafe<TrainingDoc>(`projects/${projectId}/trainings`),
  ]);

  // Map a los shapes esperados por ConsistencyState. Defensivos contra
  // docs malformados (uid faltante, etc.) — los filtramos.
  const workers = workerDocs
    .filter((w) => typeof w.uid === 'string')
    .map((w) => ({
      uid: w.uid!,
      role: w.role ?? 'trabajador',
      activeTrainings: w.activeTrainings ?? [],
      activeEppLabels: w.activeEppLabels ?? [],
      isActive: w.isActive !== false,
    }));

  const taskAssignments = taskAssignmentDocs
    .filter((t) => typeof t.taskId === 'string' && typeof t.workerUid === 'string')
    .map((t) => ({
      taskId: t.taskId!,
      workerUid: t.workerUid!,
      riskType: t.riskType ?? 'unspecified',
      requiredTrainings: t.requiredTrainings ?? [],
      requiredEpp: t.requiredEpp ?? [],
    }));

  const documents = documentDocs
    .filter((d) => typeof d.id === 'string' && typeof d.status === 'string')
    .map((d) => ({
      id: d.id!,
      status: d.status!,
      signedBy: d.signedBy ?? null,
      approvedAt: d.approvedAt ?? null,
    }));

  const correctiveActions = correctiveActionDocs
    .filter((c) => typeof c.id === 'string' && typeof c.status === 'string')
    .map((c) => ({
      id: c.id!,
      status: c.status!,
      closedAt: c.closedAt ?? null,
      evidenceRequired: c.evidenceRequired ?? false,
      evidenceUrls: c.evidenceUrls,
    }));

  const workPermits = workPermitDocs
    .filter((p) => typeof p.id === 'string' && typeof p.approverUid === 'string')
    .map((p) => ({
      id: p.id!,
      approverUid: p.approverUid!,
      expiresAt: p.expiresAt,
      status: p.status ?? 'active',
    }));

  const trainings = trainingDocs
    .filter((t) => typeof t.id === 'string' && typeof t.workerUid === 'string')
    .map((t) => ({
      id: t.id!,
      workerUid: t.workerUid!,
      course: t.course ?? 'unspecified',
      completedAt: t.completedAt ?? null,
      attendanceRegistered: t.attendanceRegistered ?? false,
    }));

  // activeApproverUids derivado: workers con role∈approver si el caller
  // no lo pasó explícito.
  const APPROVER_ROLES = new Set(['supervisor', 'prevencionista', 'gerente', 'admin']);
  const derivedApprovers =
    options.activeApproverUids ??
    workers.filter((w) => APPROVER_ROLES.has(w.role) && w.isActive).map((w) => w.uid);

  return {
    workers,
    taskAssignments,
    documents,
    correctiveActions,
    workPermits,
    trainings,
    validRoles: options.validRoles ?? DEFAULT_VALID_ROLES,
    eppByRole: options.eppByRole ?? {},
    activeApproverUids: derivedApprovers,
  };
}

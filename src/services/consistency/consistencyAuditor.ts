// Praeventio Guard — Sprint 39 Fase G.3: revisión de consistencia entre módulos.
//
// Cierra: Documento usuario "Recomendaciones nuevas §18"
//         Plan integral Top 15 #13
//
// Auditor interno automático que detecta contradicciones entre módulos.
// Ejemplos:
//   - worker asignado a tarea de altura sin training altura vigente
//   - EPP entregado no corresponde al cargo
//   - documento aprobado pero sin firma
//   - acción correctiva cerrada sin evidencia
//   - capacitación vigente pero sin asistencia registrada
//   - permiso de trabajo activo cuyo aprobador ya no existe
//
// Diseño:
//   - PURO: recibe estado consolidado, devuelve Inconsistency[]
//   - 12 reglas iniciales — extensible por PR pequeño
//   - Sin LLM, todo determinístico

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type InconsistencySeverity = 'info' | 'warning' | 'critical';

export interface Inconsistency {
  ruleId: string;
  severity: InconsistencySeverity;
  category: string;
  /** Descripción humana del problema detectado. */
  description: string;
  /** IDs de los nodos involucrados (para drill-down). */
  involvedIds: string[];
  /** Acción sugerida (texto). */
  suggestedAction: string;
}

export interface ConsistencyState {
  workers: Array<{
    uid: string;
    role: string;
    activeTrainings: string[];
    activeEppLabels: string[];
    isActive: boolean;
  }>;
  /** Tareas asignadas. Cada tarea referencia el worker y el riskType. */
  taskAssignments: Array<{
    taskId: string;
    workerUid: string;
    riskType: string;
    /** Training codes que esta tarea requiere. */
    requiredTrainings: string[];
    /** EPP labels que esta tarea requiere. */
    requiredEpp: string[];
  }>;
  documents: Array<{
    id: string;
    status: 'draft' | 'approved' | 'signed' | 'expired';
    signedBy?: string | null;
    approvedAt?: string | null;
  }>;
  /** Acciones correctivas. */
  correctiveActions: Array<{
    id: string;
    status: 'open' | 'closed' | 'verified';
    closedAt?: string | null;
    /** Si el cierre requiere evidencia y NO tiene → inconsistencia. */
    evidenceRequired: boolean;
    evidenceUrls?: string[];
  }>;
  /** Permisos de trabajo activos. */
  workPermits: Array<{
    id: string;
    approverUid: string;
    expiresAt?: string;
    status: 'active' | 'expired';
  }>;
  /** Capacitaciones registradas con flag de asistencia. */
  trainings: Array<{
    id: string;
    workerUid: string;
    course: string;
    completedAt?: string | null;
    attendanceRegistered: boolean;
  }>;
  /** Inventario de roles válidos en la organización. */
  validRoles: string[];
  /** EPP esperado por cargo (subset, no exhaustivo). */
  eppByRole?: Record<string, string[]>;
  /** Set de UIDs de aprobadores activos (para detectar permits con
   *  aprobador ausente). */
  activeApproverUids: string[];
}

// ────────────────────────────────────────────────────────────────────────
// Rules
// ────────────────────────────────────────────────────────────────────────

type Rule = (state: ConsistencyState) => Inconsistency[];

const R01_task_missing_training: Rule = (s) => {
  const issues: Inconsistency[] = [];
  for (const t of s.taskAssignments) {
    const worker = s.workers.find((w) => w.uid === t.workerUid);
    if (!worker || !worker.isActive) continue;
    const missing = t.requiredTrainings.filter(
      (req) => !worker.activeTrainings.includes(req),
    );
    if (missing.length > 0) {
      issues.push({
        ruleId: 'R01_task_missing_training',
        severity: 'critical',
        category: 'training',
        description: `Trabajador ${t.workerUid} asignado a tarea ${t.taskId} (${t.riskType}) sin training: ${missing.join(', ')}`,
        involvedIds: [t.workerUid, t.taskId],
        suggestedAction: `Programar capacitación ${missing.join(', ')} o reasignar la tarea`,
      });
    }
  }
  return issues;
};

const R02_task_missing_epp: Rule = (s) => {
  const issues: Inconsistency[] = [];
  for (const t of s.taskAssignments) {
    const worker = s.workers.find((w) => w.uid === t.workerUid);
    if (!worker || !worker.isActive) continue;
    const missing = t.requiredEpp.filter(
      (req) => !worker.activeEppLabels.includes(req),
    );
    if (missing.length > 0) {
      issues.push({
        ruleId: 'R02_task_missing_epp',
        severity: 'critical',
        category: 'epp',
        description: `Trabajador ${t.workerUid} en tarea ${t.taskId} sin EPP: ${missing.join(', ')}`,
        involvedIds: [t.workerUid, t.taskId],
        suggestedAction: `Entregar EPP ${missing.join(', ')} antes de iniciar tarea`,
      });
    }
  }
  return issues;
};

const R03_doc_approved_unsigned: Rule = (s) => {
  return s.documents
    .filter((d) => d.status === 'approved' && !d.signedBy)
    .map((d) => ({
      ruleId: 'R03_doc_approved_unsigned',
      severity: 'warning',
      category: 'documentation',
      description: `Documento ${d.id} marcado como aprobado pero sin firma`,
      involvedIds: [d.id],
      suggestedAction: 'Completar firma electrónica o devolver a draft',
    }));
};

const R04_action_closed_no_evidence: Rule = (s) => {
  return s.correctiveActions
    .filter(
      (a) =>
        a.status === 'closed' &&
        a.evidenceRequired &&
        (!a.evidenceUrls || a.evidenceUrls.length === 0),
    )
    .map((a) => ({
      ruleId: 'R04_action_closed_no_evidence',
      severity: 'critical',
      category: 'audits',
      description: `Acción correctiva ${a.id} cerrada sin evidencia (la regla la exige)`,
      involvedIds: [a.id],
      suggestedAction: 'Adjuntar evidencia o reabrir la acción',
    }));
};

const R05_training_no_attendance: Rule = (s) => {
  return s.trainings
    .filter((t) => t.completedAt && !t.attendanceRegistered)
    .map((t) => ({
      ruleId: 'R05_training_no_attendance',
      severity: 'warning',
      category: 'training',
      description: `Capacitación ${t.id} (${t.course}) marcada completada para ${t.workerUid} sin asistencia registrada`,
      involvedIds: [t.id, t.workerUid],
      suggestedAction: 'Validar lista de asistencia o invalidar el registro',
    }));
};

const R06_permit_orphan_approver: Rule = (s) => {
  return s.workPermits
    .filter(
      (p) => p.status === 'active' && !s.activeApproverUids.includes(p.approverUid),
    )
    .map((p) => ({
      ruleId: 'R06_permit_orphan_approver',
      severity: 'critical',
      category: 'permits',
      description: `Permiso ${p.id} activo con aprobador ${p.approverUid} que no figura activo`,
      involvedIds: [p.id, p.approverUid],
      suggestedAction: 'Reasignar el permiso a un aprobador vigente o revocarlo',
    }));
};

const R07_worker_invalid_role: Rule = (s) => {
  return s.workers
    .filter((w) => w.isActive && !s.validRoles.includes(w.role))
    .map((w) => ({
      ruleId: 'R07_worker_invalid_role',
      severity: 'warning',
      category: 'data_quality',
      description: `Trabajador ${w.uid} tiene role '${w.role}' que no está en la lista de roles válidos`,
      involvedIds: [w.uid],
      suggestedAction: 'Corregir cargo en el perfil del trabajador',
    }));
};

const R08_role_epp_mismatch: Rule = (s) => {
  if (!s.eppByRole) return [];
  const issues: Inconsistency[] = [];
  for (const w of s.workers) {
    if (!w.isActive) continue;
    const expected = s.eppByRole[w.role];
    if (!expected) continue;
    const missing = expected.filter((e) => !w.activeEppLabels.includes(e));
    if (missing.length > 0) {
      issues.push({
        ruleId: 'R08_role_epp_mismatch',
        severity: 'warning',
        category: 'epp',
        description: `Trabajador ${w.uid} (${w.role}) sin EPP base de su cargo: ${missing.join(', ')}`,
        involvedIds: [w.uid],
        suggestedAction: `Entregar EPP base del cargo: ${missing.join(', ')}`,
      });
    }
  }
  return issues;
};

const R09_permit_expired_active: Rule = (s) => {
  return s.workPermits
    .filter((p) => p.status === 'active' && p.expiresAt && Date.parse(p.expiresAt) < Date.now())
    .map((p) => ({
      ruleId: 'R09_permit_expired_active',
      severity: 'critical',
      category: 'permits',
      description: `Permiso ${p.id} marcado 'active' pero expiresAt ya pasó`,
      involvedIds: [p.id],
      suggestedAction: 'Cerrar el permiso o renovarlo',
    }));
};

const R10_doc_signed_no_approval: Rule = (s) => {
  return s.documents
    .filter((d) => d.status === 'signed' && !d.approvedAt)
    .map((d) => ({
      ruleId: 'R10_doc_signed_no_approval',
      severity: 'warning',
      category: 'documentation',
      description: `Documento ${d.id} firmado pero sin timestamp de aprobación`,
      involvedIds: [d.id],
      suggestedAction: 'Validar workflow approval → signed; agregar approvedAt',
    }));
};

const R11_orphan_task: Rule = (s) => {
  const workerUids = new Set(s.workers.map((w) => w.uid));
  return s.taskAssignments
    .filter((t) => !workerUids.has(t.workerUid))
    .map((t) => ({
      ruleId: 'R11_orphan_task',
      severity: 'critical',
      category: 'data_quality',
      description: `Tarea ${t.taskId} asignada a worker ${t.workerUid} que no existe`,
      involvedIds: [t.taskId],
      suggestedAction: 'Reasignar la tarea o eliminar la referencia',
    }));
};

const R12_inactive_worker_active_task: Rule = (s) => {
  const inactiveUids = new Set(
    s.workers.filter((w) => !w.isActive).map((w) => w.uid),
  );
  return s.taskAssignments
    .filter((t) => inactiveUids.has(t.workerUid))
    .map((t) => ({
      ruleId: 'R12_inactive_worker_active_task',
      severity: 'critical',
      category: 'data_quality',
      description: `Tarea ${t.taskId} asignada a trabajador ${t.workerUid} INACTIVO`,
      involvedIds: [t.taskId, t.workerUid],
      suggestedAction: 'Reasignar la tarea a un trabajador activo',
    }));
};

const ALL_RULES: Rule[] = [
  R01_task_missing_training,
  R02_task_missing_epp,
  R03_doc_approved_unsigned,
  R04_action_closed_no_evidence,
  R05_training_no_attendance,
  R06_permit_orphan_approver,
  R07_worker_invalid_role,
  R08_role_epp_mismatch,
  R09_permit_expired_active,
  R10_doc_signed_no_approval,
  R11_orphan_task,
  R12_inactive_worker_active_task,
];

// ────────────────────────────────────────────────────────────────────────
// API
// ────────────────────────────────────────────────────────────────────────

export function runConsistencyAudit(state: ConsistencyState): Inconsistency[] {
  const all: Inconsistency[] = [];
  for (const rule of ALL_RULES) {
    all.push(...rule(state));
  }
  return all;
}

export interface ConsistencyAuditSummary {
  totalIssues: number;
  byCategory: Record<string, number>;
  bySeverity: Record<InconsistencySeverity, number>;
  criticalCount: number;
}

export function summarizeConsistencyAudit(issues: Inconsistency[]): ConsistencyAuditSummary {
  const byCategory: Record<string, number> = {};
  const bySeverity: Record<InconsistencySeverity, number> = {
    info: 0,
    warning: 0,
    critical: 0,
  };
  for (const i of issues) {
    byCategory[i.category] = (byCategory[i.category] ?? 0) + 1;
    bySeverity[i.severity] = (bySeverity[i.severity] ?? 0) + 1;
  }
  return {
    totalIssues: issues.length,
    byCategory,
    bySeverity,
    criticalCount: bySeverity.critical,
  };
}
